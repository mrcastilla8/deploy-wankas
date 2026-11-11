import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { safeInternalRedirect } from '../../src/lib/safeRedirect.ts';
import { AuthRequestGuard, AuthSessionController } from '../../src/lib/authSessionController.ts';
import { registerWithSupabase } from '../../src/lib/registrationFlow.ts';
import { createCatalogResponse, fetchProducts, mapProductRows, ProductCatalogError, ProductCatalogUnavailableError } from '../../src/services/productCatalog.ts';

test('solo acepta rutas internas seguras', () => {
  assert.equal(safeInternalRedirect('/profile'), '/profile');
  assert.equal(safeInternalRedirect('/products?category=frutas'), '/products?category=frutas');
  for (const value of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/\\evil.example', '/%5c%5cevil.example', '/%0d%0aLocation:x', '/%2f%2fevil.example', '/%252f%252fevil.example', '/%ZZ']) {
    assert.equal(safeInternalRedirect(value), '/profile', value);
  }
});

test('las lecturas de perfil viejas no pueden publicar identidad tras cambio, logout o desmontaje', async () => {
  const guard = new AuthRequestGuard();
  const userA = guard.begin();
  const userB = guard.begin();
  assert.equal(guard.isCurrent(userA), false);
  assert.equal(guard.isCurrent(userB), true);
  const pendingLogout = guard.begin();
  guard.invalidate();
  assert.equal(guard.isCurrent(pendingLogout), false);
  const pendingUnmount = guard.begin();
  guard.dispose();
  assert.equal(guard.isCurrent(pendingUnmount), false);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function session(id, token = `token-${id}`, role) {
  return { access_token: token, user: { id, email: `${id}@example.test`, user_metadata: { name: `Nombre ${id}`, ...(role ? { role } : {}) } } };
}

class SupabaseDouble {
  constructor({ initialSession = null, profileReader = async id => ({ data: { id, name: `Perfil ${id}`, email: `${id}@example.test`, phone_number: null, role: 'customer' }, error: null }), signOutResult = { error: null } } = {}) {
    this.callbacks = [];
    this.profileCalls = [];
    this.initialSession = initialSession;
    this.profileReader = profileReader;
    this.signOutResult = signOutResult;
    this.unsubscribed = false;
  }
  auth = {
    onAuthStateChange: callback => {
      this.callbacks.push(callback);
      return { data: { subscription: { unsubscribe: () => { this.unsubscribed = true; } } } };
    },
    getSession: async () => ({ data: { session: this.initialSession }, error: null }),
    signOut: async () => this.signOutResult,
  };
  from = table => ({ select: fields => ({ eq: (column, id) => ({ maybeSingle: () => {
    assert.equal(table, 'profiles');
    assert.equal(fields, 'id, name, email, phone_number, role');
    assert.equal(column, 'id');
    this.profileCalls.push(id);
    return this.profileReader(id);
  } }) }) });
  emit(event, activeSession) { for (const callback of this.callbacks) callback(event, activeSession); }
}

function mountedController(double) {
  const states = [];
  const sideEffects = { invalidations: 0, logoutErrors: 0, redirects: 0 };
  const controller = new AuthSessionController(
    double,
    state => states.push({ ...state }),
    () => { sideEffects.invalidations += 1; },
    () => { sideEffects.logoutErrors += 1; },
    () => { sideEffects.redirects += 1; },
  );
  const dispose = controller.start();
  return { controller, states, sideEffects, dispose };
}

const settleAuth = () => new Promise(resolve => setTimeout(resolve, 20));

test('INITIAL_SESSION sin sesión termina la carga y conserva usuario nulo, incluso duplicado', async () => {
  const double = new SupabaseDouble();
  const mounted = mountedController(double);
  await settleAuth();
  assert.deepEqual(mounted.states.at(-1), { user: null, isLoading: false });
  assert.equal(double.profileCalls.length, 0);
  double.emit('INITIAL_SESSION', null);
  double.emit('INITIAL_SESSION', null);
  await settleAuth();
  assert.deepEqual(mounted.states.at(-1), { user: null, isLoading: false });
  assert.equal(mounted.sideEffects.invalidations, 1);
  mounted.dispose();
});

test('INITIAL_SESSION con sesión y SIGNED_IN hidratan perfil real del controlador', async () => {
  const initial = new SupabaseDouble({ initialSession: session('inicial') });
  const mountedInitial = mountedController(initial);
  await settleAuth();
  assert.equal(mountedInitial.states.at(-1).user.id, 'inicial');
  assert.equal(mountedInitial.states.at(-1).user.role, 'customer');
  assert.equal(mountedInitial.states.at(-1).isLoading, false);
  mountedInitial.dispose();

  const lateInitial = new SupabaseDouble();
  const mountedLateInitial = mountedController(lateInitial);
  await settleAuth();
  assert.deepEqual(mountedLateInitial.states.at(-1), { user: null, isLoading: false });
  lateInitial.emit('INITIAL_SESSION', session('recuperada'));
  await settleAuth();
  assert.equal(mountedLateInitial.states.at(-1).user.id, 'recuperada');
  assert.equal(mountedLateInitial.states.at(-1).isLoading, false);
  mountedLateInitial.dispose();

  const signedIn = new SupabaseDouble();
  const mountedSignedIn = mountedController(signedIn);
  signedIn.emit('SIGNED_IN', session('nuevo', 'token-nuevo', 'admin'));
  await settleAuth();
  assert.deepEqual(signedIn.profileCalls, ['nuevo']);
  assert.equal(mountedSignedIn.states.at(-1).user.id, 'nuevo');
  assert.equal(mountedSignedIn.states.at(-1).user.role, 'customer', 'El rol viene del perfil, no de user_metadata.role=admin');
  mountedSignedIn.dispose();
});

test('el flujo de registro con doble Supabase distingue sesión activa y confirmación pendiente', async () => {
  const input = { email: 'cliente@example.test', password: 'contraseña-segura', name: 'Cliente' };
  const runWithDouble = async data => {
    const calls = [];
    const effects = [];
    const auth = { signUp: async params => { calls.push(params); return { data, error: null }; } };
    await registerWithSupabase(auth, input, {
      onAuthenticated: () => effects.push('profile'),
      onConfirmationRequired: () => effects.push('confirm-email'),
      onError: error => effects.push(`error:${error.message}`),
      onUnexpected: () => effects.push('unexpected'),
    });
    return { calls, effects };
  };

  const active = await runWithDouble({ user: { id: 'auth-1' }, session: { access_token: 'fake-access-token' } });
  assert.deepEqual(active.effects, ['profile']);
  assert.deepEqual(active.calls, [{ email: input.email, password: input.password, options: { data: { name: input.name } } }]);

  const confirmation = await runWithDouble({ user: { id: 'auth-2' }, session: null });
  assert.deepEqual(confirmation.effects, ['confirm-email']);
  assert.deepEqual(confirmation.calls[0].options.data, { name: input.name });

  const failed = [];
  await registerWithSupabase({ signUp: async () => ({ data: { user: null, session: null }, error: { message: 'invalid email' } }) }, input, {
    onAuthenticated: () => failed.push('profile'),
    onConfirmationRequired: () => failed.push('confirm-email'),
    onError: error => failed.push(`error:${error.message}`),
    onUnexpected: () => failed.push('unexpected'),
  });
  assert.deepEqual(failed, ['error:invalid email']);
});

test('cambio A → B limpia A de inmediato y la respuesta antigua pendiente no reemplaza B', async () => {
  const reads = new Map();
  const double = new SupabaseDouble({ profileReader: id => {
    const request = deferred();
    reads.set(id, request);
    return request.promise;
  } });
  const mounted = mountedController(double);
  double.emit('SIGNED_IN', session('A'));
  await settleAuth();
  assert.deepEqual(double.profileCalls, ['A']);
  double.emit('SIGNED_IN', session('B'));
  assert.deepEqual(mounted.states.at(-1), { user: null, isLoading: true });
  await settleAuth();
  assert.deepEqual(double.profileCalls, ['A', 'B']);
  reads.get('B').resolve({ data: { id: 'B', name: 'Perfil B', email: 'B@example.test', role: 'customer' }, error: null });
  await settleAuth();
  reads.get('A').resolve({ data: { id: 'A', name: 'Perfil A', email: 'A@example.test', role: 'admin' }, error: null });
  await settleAuth();
  assert.equal(mounted.states.at(-1).user.id, 'B');
  assert.equal(mounted.states.at(-1).user.role, 'customer');
  mounted.dispose();
});

test('SIGNED_OUT y logout mientras el perfil está pendiente descartan la identidad anterior', async () => {
  const pending = deferred();
  const double = new SupabaseDouble({ profileReader: () => pending.promise });
  const mounted = mountedController(double);
  double.emit('SIGNED_IN', session('A'));
  await settleAuth();
  double.emit('SIGNED_OUT', null);
  assert.deepEqual(mounted.states.at(-1), { user: null, isLoading: false });
  pending.resolve({ data: { id: 'A', name: 'Perfil A', email: 'A@example.test', role: 'customer' }, error: null });
  await settleAuth();
  assert.equal(mounted.states.at(-1).user, null);
  mounted.dispose();

  const logoutPending = deferred();
  const logoutDouble = new SupabaseDouble({ initialSession: session('A'), profileReader: () => logoutPending.promise });
  const logoutMounted = mountedController(logoutDouble);
  await settleAuth();
  assert.deepEqual(logoutDouble.profileCalls, ['A']);
  assert.equal(await logoutMounted.controller.logout(), true);
  assert.equal(logoutMounted.states.at(-1).user, null);
  logoutPending.resolve({ data: { id: 'A', name: 'Perfil A', email: 'A@example.test', role: 'admin' }, error: null });
  await settleAuth();
  assert.equal(logoutMounted.states.at(-1).user, null);
  assert.equal(logoutMounted.sideEffects.redirects, 1);
  logoutMounted.dispose();
});

test('el refresh del token de la misma cuenta conserva su identidad durante la nueva lectura', async () => {
  const secondRead = deferred();
  let reads = 0;
  const double = new SupabaseDouble({ initialSession: session('A'), profileReader: async id => {
    reads += 1;
    return reads === 1 ? { data: { id, name: 'Perfil A', email: 'A@example.test', role: 'customer' }, error: null } : secondRead.promise;
  } });
  const mounted = mountedController(double);
  await settleAuth();
  const currentUser = mounted.states.at(-1).user;
  double.emit('TOKEN_REFRESHED', session('A', 'token-A-rotado'));
  assert.equal(mounted.states.at(-1).user, currentUser);
  assert.equal(mounted.states.at(-1).isLoading, false);
  secondRead.resolve({ data: { id: 'A', name: 'Perfil actualizado', email: 'A@example.test', role: 'customer' }, error: null });
  await settleAuth();
  assert.equal(mounted.states.at(-1).user.name, 'Perfil actualizado');
  mounted.dispose();
});

test('un error de perfil mantiene sesión autenticada y finaliza la carga', async () => {
  const double = new SupabaseDouble({ profileReader: async () => ({ data: null, error: new Error('detalle interno') }) });
  const mounted = mountedController(double);
  double.emit('SIGNED_IN', session('A'));
  await settleAuth();
  assert.equal(mounted.states.at(-1).user.id, 'A');
  assert.equal(mounted.states.at(-1).user.role, null);
  assert.equal(mounted.states.at(-1).isLoading, false);
  mounted.dispose();
});

test('fallo de signOut conserva identidad y desmontaje ignora una hidratación pendiente', async () => {
  const double = new SupabaseDouble({ initialSession: session('A'), signOutResult: { error: new Error('no se pudo cerrar') } });
  const mounted = mountedController(double);
  await settleAuth();
  const stateBefore = mounted.states.at(-1);
  assert.equal(await mounted.controller.logout(), false);
  assert.deepEqual(mounted.states.at(-1), stateBefore);
  assert.equal(mounted.sideEffects.logoutErrors, 1);
  mounted.dispose();

  const pending = deferred();
  const unmountDouble = new SupabaseDouble({ profileReader: () => pending.promise });
  const unmounted = mountedController(unmountDouble);
  unmountDouble.emit('SIGNED_IN', session('pendiente'));
  await settleAuth();
  const updateCountBeforeUnmount = unmounted.states.length;
  unmounted.dispose();
  pending.resolve({ data: { id: 'pendiente', name: 'Tardío', email: null, role: 'customer' }, error: null });
  await settleAuth();
  assert.equal(unmounted.states.length, updateCountBeforeUnmount);
  assert.equal(unmountDouble.unsubscribed, true);
});

test('el catálogo conserva IDs y productos con nombres duplicados, y acepta lista vacía', async () => {
  const rows = [
    { id: 'pg-1', name_es: 'Papa', description_es: null, price: 2.5, stock: 3, categories: { name_es: 'Tubérculos' } },
    { id: 'pg-2', name_es: 'Papa', description_es: 'Otra variedad', price: 3, stock: 4, categories: { name_es: 'Tubérculos' } },
  ];
  const products = mapProductRows(rows);
  assert.deepEqual(products.map(product => product.id), ['pg-1', 'pg-2']);
  assert.deepEqual(mapProductRows([]), []);
  assert.throws(() => mapProductRows([{ ...rows[0], price: null }]), ProductCatalogError);
  const uncategorized = mapProductRows([{ ...rows[0], categories: null }]);
  assert.equal(uncategorized[0].category, 'Sin categoría');
  const categoryResponse = await createCatalogResponse(async () => uncategorized);
  assert.equal(categoryResponse.status, 200);
  assert.equal((await categoryResponse.json())[0].category, 'Sin categoría');
});

test('la consulta de catálogo propaga fallos y permite reintentar sin caché', async () => {
  const makeClient = result => ({ from: table => {
    assert.equal(table, 'products');
    return { select: columns => {
      assert.match(columns, /price.*stock.*categories/);
      return { order: async (field, options) => {
        assert.equal(field, 'name_es');
        assert.deepEqual(options, { ascending: true });
        return typeof result === 'function' ? result() : result;
      } };
    } };
  } });
  await assert.rejects(fetchProducts(makeClient({ data: null, error: new Error('private db detail') })), ProductCatalogError);
  await assert.rejects(fetchProducts(makeClient({ data: null, error: null })), ProductCatalogError);
  assert.deepEqual(await fetchProducts(makeClient({ data: [], error: null })), []);
  let attempts = 0;
  const retryClient = makeClient(() => ++attempts === 1 ? { data: null, error: new Error('offline') } : { data: [], error: null });
  await assert.rejects(fetchProducts(retryClient), ProductCatalogError);
  assert.deepEqual(await fetchProducts(retryClient), []);
});

test('la API distingue catálogo vacío, dependencia no disponible y fallo interno sin cachear', async () => {
  const ok = await createCatalogResponse(async () => []);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), []);
  assert.equal(ok.headers.get('cache-control'), 'no-store, max-age=0');
  const unavailable = await createCatalogResponse(async () => { throw new ProductCatalogUnavailableError('secreto de conexión'); });
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /secreto de conexión/);
  const unexpected = await createCatalogResponse(async () => { throw new Error('private detail'); });
  assert.equal(unexpected.status, 500);
  assert.doesNotMatch(await unexpected.text(), /private detail/);
  const invalidData = await createCatalogResponse(async () => { throw new ProductCatalogError('corrupt row'); });
  assert.equal(invalidData.status, 500);
});

test('el flujo heredado de Server Actions no existe ni conserva consumidores', async () => {
  await assert.rejects(access(new URL('../../src/actions/auth.ts', import.meta.url)));
  const root = fileURLToPath(new URL('../../src/', import.meta.url));
  const references = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
        const source = await readFile(path, 'utf8');
        if (/registerUser|loginUser|actions\/auth/.test(source)) references.push(path);
      }
    }
  }
  await visit(root);
  assert.deepEqual(references, [], `Se encontraron consumidores heredados: ${references.join(', ')}`);
});

test('el registro solo envía nombre y los logs Genkit no imprimen entradas', async () => {
  const registration = await readFile(new URL('../../src/components/auth/register-form.tsx', import.meta.url), 'utf8');
  assert.match(registration, /registerWithSupabase\(supabase\.auth,\s*\{\s*email,\s*password,\s*name\s*\}/);
  assert.match(registration, /onAuthenticated:[\s\S]*?router\.push\('\/profile'\)/);
  const confirmationHandler = registration.split('onConfirmationRequired:')[1]?.split('onError:')[0];
  assert.ok(confirmationHandler);
  assert.match(confirmationHandler, /translations\.registerForm\.confirmEmailTitle/);
  assert.match(confirmationHandler, /translations\.registerForm\.confirmEmailDesc/);
  assert.doesNotMatch(confirmationHandler, /router\.push/);
  const registrationFlow = await readFile(new URL('../../src/lib/registrationFlow.ts', import.meta.url), 'utf8');
  assert.match(registrationFlow, /options:\s*\{\s*data:\s*\{\s*name:\s*credentials\.name\s*\}\s*\}/);
  assert.doesNotMatch(registrationFlow, /role\s*:/);
  assert.doesNotMatch(registration, /role\s*:/);
  const english = await readFile(new URL('../../src/locales/en.ts', import.meta.url), 'utf8');
  const spanish = await readFile(new URL('../../src/locales/es.ts', import.meta.url), 'utf8');
  assert.match(english, /confirmEmailDesc:\s*"Check your inbox and confirm your email before signing in\."/);
  assert.match(spanish, /confirmEmailDesc:\s*"Revisa tu bandeja de entrada y confirma tu correo antes de iniciar sesión\."/);
  const supabaseClient = await readFile(new URL('../../src/lib/supabaseClient.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(supabaseClient, /Cross-app SSO|\/api\/auth\/session/);
  const authController = await readFile(new URL('../../src/lib/authSessionController.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(authController, /user_metadata\??\.role/);
  for (const file of ['identify-food-items.ts', 'suggest-recipes.ts', 'suggest-missing-ingredients.ts']) {
    const source = await readFile(new URL(`../../src/ai/flows/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*(?:input|promptParts|photoDataUris|availableIngredients)/i, file);
  }
});
