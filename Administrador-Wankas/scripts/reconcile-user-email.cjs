const { parseArgs } = require('node:util');
const { createClient } = require('@supabase/supabase-js');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class RecoveryError extends Error {}

async function readEmailPair(supabase, id) {
  const { data: profile, error: profileError } = await supabase.schema('public').from('profiles')
    .select('email, updated_at').eq('id', id).maybeSingle();
  if (profileError || !profile || !Number.isFinite(Date.parse(profile.updated_at))) {
    throw new RecoveryError('No se pudo leer el perfil y su versión.');
  }

  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error || data.user?.id !== id) throw new RecoveryError('No se pudo confirmar la cuenta en Auth.');
  return { profile, authEmail: data.user.email ?? null };
}

// Apply only after all email writers for this account have been paused and drained.
async function reconcileUserEmail(supabase, userId, { apply = false } = {}) {
  if (typeof userId !== 'string' || !uuid.test(userId)) throw new RecoveryError('El ID de usuario debe ser un UUID.');
  const id = userId.toLowerCase();
  const { profile, authEmail } = await readEmailPair(supabase, id);
  if (profile.email === authEmail) return { userId: id, status: 'aligned' };
  if (!apply) return { userId: id, status: 'mismatch' };

  const updatedAt = new Date(Math.max(Date.now(), Date.parse(profile.updated_at) + 1)).toISOString();
  const update = supabase.schema('public').from('profiles')
    .update({ email: authEmail, updated_at: updatedAt }).eq('id', id).eq('updated_at', profile.updated_at);
  const guarded = profile.email === null ? update.is('email', null) : update.eq('email', profile.email);
  const { data, error } = await guarded.select('id').maybeSingle();
  if (error) throw new RecoveryError('No se confirmó la escritura en el perfil. Repite el diagnóstico antes de reintentar.');
  if (data?.id !== id) throw new RecoveryError('El perfil cambió desde la lectura. Revisa el caso antes de reintentar.');

  const confirmed = await readEmailPair(supabase, id);
  if (confirmed.profile.email !== authEmail || confirmed.authEmail !== authEmail) {
    throw new RecoveryError('Auth y el perfil cambiaron durante la reconciliación. Mantén pausadas las escrituras.');
  }
  return { userId: id, status: 'reconciled' };
}

async function main() {
  const { values } = parseArgs({
    options: { 'project-url': { type: 'string' }, 'user-id': { type: 'string' }, apply: { type: 'boolean' } },
  });
  if (!values['project-url'] || !values['user-id']) {
    throw new RecoveryError('Uso: node scripts/reconcile-user-email.cjs --project-url <URL> --user-id <UUID> [--apply]');
  }
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!configuredUrl || !serviceKey) throw new RecoveryError('Falta la configuración de Supabase en el entorno del servidor.');
  const project = new URL(configuredUrl);
  if (project.href !== new URL(values['project-url']).href) {
    throw new RecoveryError('La URL solicitada difiere del proyecto Supabase configurado.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(project.hostname);
  if (project.protocol !== 'https:' && !(local && project.protocol === 'http:')) {
    throw new RecoveryError('Usa HTTPS o una instancia HTTP local.');
  }

  const supabase = createClient(project.href, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const result = await reconcileUserEmail(supabase, values['user-id'], { apply: values.apply });
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof RecoveryError ? error.message : 'La reconciliación se interrumpió. Revisa los argumentos y el estado del usuario.');
    process.exitCode = 1;
  });
}

module.exports = { reconcileUserEmail };
