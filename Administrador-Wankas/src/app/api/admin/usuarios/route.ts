import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/adminClient';
import type { Database } from '@/types/database.types';

const CACHE_KEY = 'admin:usuarios';
const authRejectionStatuses = new Set([400, 401, 403, 404, 409, 422, 429]);
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const profileFields = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().toLowerCase(),
  role: z.enum(['worker', 'admin']),
  location_id: uuid.nullable().optional(),
});
const createBody = profileFields.extend({ password: z.string().min(6) }).strict();
const updateBody = profileFields.partial().extend({ id: uuid }).strict()
  .refine(({ name, email, role, location_id }) =>
    name !== undefined || email !== undefined || role !== undefined || location_id !== undefined);
const deleteBody = z.object({ id: uuid }).strict();

type AdminClient = ReturnType<typeof createAdminClient>;
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

// REC-01 adapter. Queries require the real nullable UUID and FK in public.profiles.
type ProfileChanges = Partial<Pick<ProfileRow, 'name' | 'email' | 'role' | 'updated_at'>> & { location_id?: string | null };
type ListedProfile = Pick<ProfileRow, 'id' | 'name' | 'email' | 'role'> & { location_id: string | null };
type EmailSnapshot = Pick<ProfileRow, 'email' | 'updated_at'>;
type ProfileGuard = Partial<EmailSnapshot & Pick<ProfileRow, 'role'>>;

function profiles(supabase: AdminClient) {
  const table = () => supabase.schema('public').from('profiles');
  return {
    list: () => table().select('id, name, email, role, location_id').order('name')
      .overrideTypes<ListedProfile[], { merge: false }>(),
    read: (id: string) => table().select('email, role, updated_at').eq('id', id).maybeSingle(),
    update: (id: string, changes: ProfileChanges, guard?: ProfileGuard) => {
      let query = table().update(changes).eq('id', id);
      if (guard?.email === null) query = query.is('email', null);
      else if (guard?.email !== undefined) query = query.eq('email', guard.email);
      if (guard?.role !== undefined) query = query.eq('role', guard.role);
      if (guard?.updated_at !== undefined) query = query.eq('updated_at', guard.updated_at);
      return query.select('id').maybeSingle();
    },
  };
}

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function internalError(operation: string, code?: string) {
  console.error('[admin/usuarios]', operation, code);
  return fail(500, 'INTERNAL_SERVER_ERROR');
}

async function withAdmin(request: Request, run: (supabase: AdminClient) => Promise<Response>) {
  try {
    const auth = await authenticateAdmin(request);
    if (!auth.ok) return auth.response;
    if (auth.principal.role !== 'admin') return fail(403, 'FORBIDDEN');

    return await run(createAdminClient());
  } catch {
    return internalError(`Unexpected ${request.method} failure`);
  }
}

async function readBody<T>(request: Request, schema: z.ZodType<T>) {
  return schema.safeParse(await request.json().catch(() => undefined));
}

async function validateLocation(supabase: AdminClient, locationId: string | null | undefined, role: string) {
  if (locationId == null) return null;
  if (role !== 'worker') return fail(400, 'LOCATION_REQUIRES_WORKER');

  const { data, error } = await supabase.schema('public').from('locations')
    .select('id').eq('id', locationId).maybeSingle();
  if (error) return internalError('Location lookup failed', error.code);
  return data ? null : fail(400, 'LOCATION_NOT_FOUND');
}

function authFailure(operation: string, error: { code?: string; status?: number }) {
  if (error.code === 'email_exists' || error.code === 'user_already_exists' || error.status === 409) {
    return fail(409, 'USER_CONFLICT');
  }
  if (error.code === 'user_not_found' || error.status === 404) return fail(400, 'USER_NOT_FOUND');
  if (error.code === 'weak_password' || error.code === 'email_address_invalid' || error.code === 'validation_failed') {
    return fail(400, 'INVALID_INPUT');
  }
  return internalError(operation, error.code);
}

async function persistProfile(
  supabase: AdminClient,
  id: string,
  changes: ProfileChanges,
  { creating = false, guard }: { creating?: boolean; guard?: ProfileGuard } = {},
) {
  try {
    const { data, error } = await profiles(supabase).update(id, changes, guard);
    if (error?.code === '23505') return fail(409, 'USER_CONFLICT');
    if (error?.code === '23503' && changes.location_id != null) return fail(409, 'LOCATION_NOT_FOUND');
    if (error) return internalError('Profile update failed', error.code);
    if (data?.id === id) return null;
    if (guard?.email !== undefined) return fail(409, 'USER_EMAIL_CONFLICT');
    if (guard?.role !== undefined) return fail(409, 'USER_CONFLICT');
    return creating ? internalError('Auth user was created without a matching profile') : fail(400, 'USER_NOT_FOUND');
  } catch {
    return internalError('Profile update threw');
  }
}

async function undoCreation(supabase: AdminClient, id: string) {
  try {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (!error || error.code === 'user_not_found' || error.status === 404) return true;
  } catch {
    // Report the same recoverable state if the request itself fails.
  }
  console.error('[admin/usuarios] Could not remove newly created Auth user', id);
  return false;
}

async function changeEmail(supabase: AdminClient, id: string, snapshot: EmailSnapshot, email: string) {
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error) return authFailure('Auth user lookup failed', error);
  if (!data.user) return fail(400, 'USER_NOT_FOUND');

  const authEmail = data.user.email?.toLowerCase();
  const { email: profileEmail, updated_at } = snapshot;
  // Claim the new email in PostgreSQL first. A competing PATCH returns a conflict
  // if its snapshot is stale or Auth has yet to apply the claimed email.
  if (profileEmail !== null && profileEmail.toLowerCase() !== authEmail) return fail(409, 'USER_EMAIL_CONFLICT');
  if (profileEmail === email && authEmail === email) return null;

  // The timestamp also fences requests that read the same address before it was changed away and back.
  const nextUpdatedAt = new Date(Math.max(Date.now(), Date.parse(updated_at) + 1)).toISOString();
  const claimError = await persistProfile(supabase, id, { email, updated_at: nextUpdatedAt }, {
    guard: { email: profileEmail, updated_at },
  });
  if (claimError?.status === 500) {
    console.error('[admin/usuarios] Could not confirm profile email reservation', id);
  }
  if (claimError || authEmail === email) return claimError;

  try {
    const result = await supabase.auth.admin.updateUserById(id, { email });
    if (!result.error && result.data.user?.email?.toLowerCase() === email) return null;

    const status = result.error?.status;
    if (result.error && status !== undefined && authRejectionStatuses.has(status)) {
      const rollbackError = await persistProfile(supabase, id, { email: profileEmail }, { guard: { email } });
      if (!rollbackError) return authFailure('Auth email update rejected', result.error);
    }
  } catch {
    // A transport failure can leave the outcome of the Auth write unknown.
  }

  // Keep the claim if Auth may still commit. Releasing it would admit a second writer.
  console.error('[admin/usuarios] Auth email change needs reconciliation', id);
  return fail(500, 'USER_UPDATE_ROLLBACK_FAILED');
}

async function mutationSucceeded(id: string, status = 200) {
  // Old cache entries may contain columns that the users API no longer serves.
  try {
    const { sessionStore } = await import('@/lib/redis');
    await sessionStore.del(CACHE_KEY);
  } catch {
    console.error('[admin/usuarios] Failed to remove legacy users cache');
  }
  return NextResponse.json({ ok: true, id }, { status });
}

export async function GET(request: Request) {
  return withAdmin(request, async (supabase) => {
    const { data, error } = await profiles(supabase).list();
    if (error || !data) return internalError('Users lookup failed', error?.code);

    const payload = data.map(({ id, name, email, role, location_id }) => ({ id, name, email, role, location_id }));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  });
}

export async function POST(request: Request) {
  return withAdmin(request, async (supabase) => {
    const body = await readBody(request, createBody);
    if (!body.success) return fail(400, 'INVALID_INPUT');
    const { name, email, password, role, location_id } = body.data;
    const locationError = await validateLocation(supabase, location_id, role);
    if (locationError) return locationError;

    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name },
    });
    if (error) return authFailure('Auth user creation failed', error);
    if (!data.user?.id) return internalError('Auth did not return the created user ID');

    const id = data.user.id;
    const profileError = await persistProfile(supabase, id, { name, email, role, location_id: location_id ?? null }, { creating: true });
    if (profileError) {
      return await undoCreation(supabase, id) ? profileError : fail(500, 'USER_CREATION_ROLLBACK_FAILED');
    }
    return mutationSucceeded(id, 201);
  });
}

export async function PATCH(request: Request) {
  return withAdmin(request, async (supabase) => {
    const body = await readBody(request, updateBody);
    if (!body.success) return fail(400, 'INVALID_INPUT');
    const { id, email, ...changes } = body.data;
    const { data: target, error } = await profiles(supabase).read(id);
    if (error) return internalError('Target profile lookup failed', error.code);
    if (!target) return fail(400, 'USER_NOT_FOUND');

    const locationError = await validateLocation(supabase, changes.location_id, changes.role ?? target.role);
    if (locationError) return locationError;
    if (changes.role === 'admin') changes.location_id = null;

    const emailChanged = email !== undefined && email !== target.email;
    if (email !== undefined) {
      const emailError = await changeEmail(supabase, id, target, email);
      if (emailError) return emailError;
    }

    if (Object.keys(changes).length > 0) {
      // An assignment without a role change must still target a worker at write time.
      const guard = changes.location_id != null && changes.role === undefined ? { role: 'worker' } : undefined;
      const profileError = await persistProfile(supabase, id, changes, { guard });
      if (profileError) {
        return emailChanged ? fail(profileError.status, 'USER_PROFILE_UPDATE_FAILED_AFTER_EMAIL_CHANGE') : profileError;
      }
    } else if (!emailChanged) {
      return NextResponse.json({ ok: true, id });
    }
    return mutationSucceeded(id);
  });
}

export async function DELETE(request: Request) {
  return withAdmin(request, async () => {
    const body = await readBody(request, deleteBody);
    if (!body.success) return fail(400, 'INVALID_INPUT');

    // REC-01 must preserve orders and order items when an existing account is deleted.
    return fail(409, 'DELETE_BLOCKED');
  });
}
