const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const { NextResponse } = require('next/server');
const ts = require('typescript');
const { z } = require('zod');
const { reconcileUserEmail } = require('../scripts/reconcile-user-email.cjs');

const actorId = '390eb33d-6dd7-4ae6-88e7-a15f186ed641';
const targetId = '0be643ed-093a-4899-9af5-a4bf87cf48d6';
const locationId = 'e90e2d78-ec91-4a4a-a760-4743cba523dc';
const authUserPath = `/auth/v1/admin/users/${targetId}`;
const profilePath = '/rest/v1/profiles';
const locationPath = '/rest/v1/locations';
const newUser = { name: 'Ana', email: 'ana@example.test', role: 'worker', password: 'example-password' };
const listedUser = { id: targetId, name: newUser.name, email: newUser.email, role: 'worker', location_id: null };
const initialUpdatedAt = '2025-01-01T00:00:00.000Z';

function loadModule(file, imports) {
  const filename = path.join(__dirname, '../src', file);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  const exports = {};
  const load = compileFunction(outputText, ['require', 'exports'], { filename });
  load((id) => {
    assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
    return imports[id];
  }, exports);
  return exports;
}

// Exercise both production modules and the real SDK, replacing only Supabase HTTP and Redis.
function harness({
  role = 'admin', targetRole = 'worker', targetLocation = null, email = newUser.email,
  profileEmail = email, intercept, afterAuthWrite, afterProfileWrite,
} = {}) {
  const calls = [];
  const state = {
    authEmail: email,
    profile: { ...listedUser, role: targetRole, location_id: targetLocation, email: profileEmail, updated_at: initialUpdatedAt },
  };
  const supabaseFetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const call = {
      method: request.method,
      path: url.pathname,
      params: url.searchParams,
      body: request.body ? await request.json() : undefined,
    };
    calls.push(call);

    const override = await intercept?.(call, state);
    if (override) return override;

    if (call.path === '/auth/v1/user') {
      return Response.json({ id: actorId, user_metadata: { role: 'admin' } });
    }
    if (call.path === profilePath && call.params.get('id') === `eq.${actorId}`) {
      return Response.json([{ role, location_id: null }]);
    }
    if (call.path === profilePath && call.method === 'GET') {
      if (call.params.get('id') === `eq.${targetId}`) {
        const { email, role, updated_at } = state.profile;
        return Response.json([{ email, role, updated_at }]);
      }
      return Response.json([{ ...state.profile, password_hash: 'test-hash', phone_number: 'test-phone' }]);
    }
    if (call.path === locationPath && call.method === 'GET') return Response.json([{ id: locationId }]);
    if (call.path === profilePath && call.method === 'PATCH') {
      const expectedEmail = state.profile.email === null ? 'is.null' : `eq.${state.profile.email}`;
      if ((call.params.has('email') && call.params.get('email') !== expectedEmail) ||
          (call.params.has('role') && call.params.get('role') !== `eq.${state.profile.role}`) ||
          (call.params.has('updated_at') && call.params.get('updated_at') !== `eq.${state.profile.updated_at}`)) {
        return Response.json({ code: 'PGRST116', details: 'The result contains 0 rows' }, { status: 406 });
      }
      Object.assign(state.profile, call.body);
      await afterProfileWrite?.(call);
      return Response.json({ id: targetId });
    }
    if (call.path === '/auth/v1/admin/users' && call.method === 'POST') {
      return Response.json({ id: targetId, email: newUser.email });
    }
    if (call.path === authUserPath) {
      if (call.method === 'PUT') {
        state.authEmail = call.body.email;
        await afterAuthWrite?.(call);
        return Response.json({ id: targetId, email: call.body.email });
      }
      return Response.json({ id: targetId, email: state.authEmail });
    }
    return Response.json({ code: 'unexpected_test_request' }, { status: 500 });
  };
  const adminClient = {
    createAdminClient: () => createClient('https://supabase.test', 'test-service-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: supabaseFetch },
    }),
  };
  const auth = loadModule('lib/adminAuth.ts', {
    'server-only': {},
    'next/server': { NextResponse },
    './supabase/adminClient': adminClient,
  });
  function createRequestHandler() {
    const route = loadModule('app/api/admin/usuarios/route.ts', {
      'next/server': { NextResponse },
      zod: { z },
      '@/lib/adminAuth': auth,
      '@/lib/supabase/adminClient': adminClient,
      '@/lib/redis': { sessionStore: { del: async (key) => calls.push({ method: 'DEL', path: key }) } },
    });
    return (method, body, token = 'valid') => route[method](new Request('https://panel.test/api/admin/usuarios', {
      method,
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }

  return { request: createRequestHandler(), createRequestHandler, supabase: adminClient.createAdminClient(), calls, state };
}

async function expectResponse(response, status, payload) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), payload);
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test('el GET anónimo devuelve 401 antes de consultar Supabase', async () => {
  const { request, calls } = harness();
  const response = await request('GET', undefined, null);
  assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  await expectResponse(response, 401, { error: 'UNAUTHORIZED' });
  assert.deepEqual(calls, []);
});

for (const role of ['worker', 'customer']) {
  test(`${role} recibe 403 en todos los métodos aunque Auth devuelva user_metadata.role=admin`, async () => {
    const { request, calls } = harness({ role });
    for (const [method, body] of [
      ['GET', undefined],
      ['POST', { ...newUser, role: 'admin' }],
      ['PATCH', { id: actorId, role: 'admin', location_id: locationId }],
      ['DELETE', { id: targetId }],
    ]) {
      calls.length = 0;
      await expectResponse(await request(method, body), 403, { error: 'FORBIDDEN' });
      assert.deepEqual(calls.map((call) => call.path), ['/auth/v1/user', profilePath]);
      assert.equal(calls[1].params.get('id'), `eq.${actorId}`);
    }
  });
}

test('el admin recibe solo los campos explícitos sin caché ni password_hash', async () => {
  const { request, calls } = harness();
  const response = await request('GET');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  await expectResponse(response, 200, [listedUser]);
  assert.equal(calls[2].params.get('select'), 'id,name,email,role,location_id');
  assert.equal(calls[2].params.get('order'), 'name.asc');
});

test('el admin crea un worker, persiste el rol y solo después invalida la caché', async () => {
  const { request, calls } = harness();
  await expectResponse(await request('POST', { ...newUser, location_id: null }), 201, { ok: true, id: targetId });
  assert.deepEqual(calls.slice(2).map(({ method, path }) => [method, path]), [
    ['POST', '/auth/v1/admin/users'], ['PATCH', profilePath], ['DEL', 'admin:usuarios'],
  ]);
  assert.deepEqual(calls[2].body, {
    email: newUser.email, password: newUser.password, email_confirm: true, user_metadata: { name: newUser.name },
  });
  assert.equal(calls[3].params.get('id'), `eq.${targetId}`);
  assert.deepEqual(calls[3].body, { name: newUser.name, email: newUser.email, role: 'worker', location_id: null });
});

test('permite crear un admin sin sede y rechaza un rol de alta no permitido', async () => {
  const { request, calls } = harness();
  await expectResponse(await request('POST', { ...newUser, role: 'customer' }), 400, { error: 'INVALID_INPUT' });
  assert.equal(calls.length, 2);

  calls.length = 0;
  await expectResponse(await request('POST', { ...newUser, role: 'admin' }), 201, { ok: true, id: targetId });
  assert.equal(calls[3].body.role, 'admin');
  assert.equal(calls[3].body.location_id, null);
});

test('POST rechaza una sede para un administrador antes de crear la cuenta', async () => {
  const { request, calls } = harness();
  await expectResponse(await request('POST', { ...newUser, role: 'admin', location_id: locationId }), 400, {
    error: 'LOCATION_REQUIRES_WORKER',
  });
  assert.equal(calls.length, 2);
});

for (const targetRole of ['admin', 'customer']) {
  test(`PATCH rechaza asignar una sede cuando el destinatario sigue siendo ${targetRole}`, async () => {
    const { request, calls, state } = harness({ targetRole });
    await expectResponse(await request('PATCH', { id: targetId, location_id: locationId }), 400, {
      error: 'LOCATION_REQUIRES_WORKER',
    });
    assert.equal(calls.length, 3);
    assert.equal(state.profile.location_id, null);
  });
}

test('PATCH evalúa el rol resultante y retira la sede al convertir un trabajador en admin', async () => {
  const { request, calls, state } = harness({ targetLocation: locationId });
  await expectResponse(await request('PATCH', { id: targetId, role: 'admin', location_id: locationId }), 400, {
    error: 'LOCATION_REQUIRES_WORKER',
  });
  assert.equal(calls.length, 3);

  await expectResponse(await request('PATCH', { id: targetId, role: 'admin' }), 200, { ok: true, id: targetId });
  assert.equal(state.profile.role, 'admin');
  assert.equal(state.profile.location_id, null);
  await expectResponse(await request('PATCH', { id: targetId, role: 'worker', location_id: locationId }), 200, { ok: true, id: targetId });
  assert.equal(state.profile.role, 'worker');
  assert.equal(state.profile.location_id, locationId);
});

test('PATCH devuelve 409 si el trabajador cambia de rol antes de que se guarde su sede', async () => {
  const { request, state, calls } = harness({
    intercept: (call, state) => {
      if (call.path === locationPath) state.profile.role = 'admin';
    },
  });
  await expectResponse(await request('PATCH', { id: targetId, location_id: locationId }), 409, { error: 'USER_CONFLICT' });
  assert.equal(calls.find(({ method }) => method === 'PATCH').params.get('role'), 'eq.worker');
  assert.equal(state.profile.location_id, null);
  assert.equal(calls.some(({ method }) => method === 'DEL'), false);
});

test('rechaza una sede inexistente antes de escribir en Auth o en perfiles', async () => {
  const { request, calls } = harness({ intercept: (call) => call.path === locationPath ? Response.json([]) : undefined });
  await expectResponse(await request('PATCH', { id: targetId, email: newUser.email, location_id: locationId }), 400, {
    error: 'LOCATION_NOT_FOUND',
  });
  assert.equal(calls.length, 4);
  assert.equal(calls[3].params.get('id'), `eq.${locationId}`);
});

test('actualiza los campos permitidos y acepta retirar la sede', async () => {
  const { request, calls, state } = harness();
  const email = 'new@example.test';
  const changes = { name: 'Ana María', role: 'worker', location_id: locationId };
  await expectResponse(await request('PATCH', { id: targetId, email, ...changes }), 200, { ok: true, id: targetId });
  assert.deepEqual(calls.slice(2).map(({ method, path }) => [method, path]), [
    ['GET', profilePath], ['GET', locationPath], ['GET', authUserPath], ['PATCH', profilePath],
    ['PUT', authUserPath], ['PATCH', profilePath], ['DEL', 'admin:usuarios'],
  ]);
  assert.equal(calls[5].body.email, email);
  assert.equal(calls[5].params.get('updated_at'), `eq.${initialUpdatedAt}`);
  assert.deepEqual(calls[6].body, { email });
  assert.deepEqual(calls[7].body, changes);
  assert.deepEqual(state.profile, { id: targetId, email, updated_at: calls[5].body.updated_at, ...changes });

  calls.length = 0;
  await expectResponse(await request('PATCH', { id: targetId, location_id: null }), 200, { ok: true, id: targetId });
  assert.deepEqual(calls[3].body, { location_id: null });
  assert.equal(calls[4].method, 'DEL');
});

test('si la sede se elimina entre la comprobación y el PATCH, devuelve 409', async () => {
  const { request, calls } = harness({
    intercept: (call) => call.method === 'PATCH' ? Response.json({ code: '23503' }, { status: 409 }) : undefined,
  });
  await expectResponse(await request('PATCH', { id: targetId, location_id: locationId }), 409, { error: 'LOCATION_NOT_FOUND' });
  assert.equal(calls.some(({ method }) => method === 'DEL'), false);
});

test('DELETE exige sesión y un UUID, y bloquea la baja antes de cualquier mutación', async () => {
  const { request, calls, state } = harness();
  await expectResponse(await request('DELETE', { id: targetId }, null), 401, { error: 'UNAUTHORIZED' });
  assert.deepEqual(calls, []);

  await expectResponse(await request('DELETE', { id: 'invalid' }), 400, { error: 'INVALID_INPUT' });
  assert.equal(calls.length, 2);

  calls.length = 0;
  await expectResponse(await request('DELETE', { id: targetId }), 409, { error: 'DELETE_BLOCKED' });
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
    ['GET', '/auth/v1/user'], ['GET', profilePath],
  ]);
  assert.equal(state.authEmail, newUser.email);
  assert.equal(state.profile.email, newUser.email);
});

test('un correo duplicado en Auth devuelve 409 y evita la escritura de perfil', async () => {
  const { request, calls } = harness({
    intercept: (call) => call.method === 'POST' ? Response.json({ code: 'email_exists' }, {
      status: 422, headers: { 'x-supabase-api-version': '2024-01-01' },
    }) : undefined,
  });
  await expectResponse(await request('POST', newUser), 409, { error: 'USER_CONFLICT' });
  assert.equal(calls.length, 3);
});

for (const rollbackFails of [false, true]) {
  test(`el alta devuelve 500 cuando el perfil falla y la compensación ${rollbackFails ? 'falla' : 'elimina la cuenta'}`, async () => {
    const { request, calls } = harness({
      intercept: (call) => call.method === 'PATCH' || (rollbackFails && call.method === 'DELETE')
        ? Response.json({ code: 'unexpected_failure', message: 'internal details' }, { status: 500 })
        : undefined,
    });
    await expectResponse(await request('POST', newUser), 500, {
      error: rollbackFails ? 'USER_CREATION_ROLLBACK_FAILED' : 'INTERNAL_SERVER_ERROR',
    });
    assert.deepEqual(calls.slice(2).map(({ method, path }) => [method, path]), [
      ['POST', '/auth/v1/admin/users'], ['PATCH', profilePath], ['DELETE', authUserPath],
    ]);
  });
}

test('el alta compensa si Auth no genera un perfil para actualizar', async () => {
  const { request, calls } = harness({
    intercept: (call) => call.method === 'PATCH' ? Response.json(null) : undefined,
  });
  await expectResponse(await request('POST', newUser), 500, { error: 'INTERNAL_SERVER_ERROR' });
  assert.equal(calls.length, 5);
  assert.equal(calls[4].method, 'DELETE');
  assert.equal(calls[4].path, authUserPath);
});

test('PATCH evita cambiar Auth si la reserva en profiles falla', async () => {
  const { request, calls, state } = harness({
    intercept: (call) => call.method === 'PATCH' ? Response.json({ code: '23505' }, { status: 409 }) : undefined,
  });
  await expectResponse(await request('PATCH', { id: targetId, email: 'new@example.test' }), 409, { error: 'USER_CONFLICT' });
  assert.equal(calls.some(({ method }) => method === 'PUT' || method === 'DEL'), false);
  assert.equal(state.authEmail, newUser.email);
  assert.equal(state.profile.email, state.authEmail);
});

test('PATCH restaura el correo del perfil ante un rechazo confirmado de Auth', async () => {
  const { request, calls, state } = harness({
    intercept: (call) => call.method === 'PUT' ? Response.json({ code: 'email_exists' }, {
      status: 422, headers: { 'x-supabase-api-version': '2024-01-01' },
    }) : undefined,
  });
  const email = 'new@example.test';
  await expectResponse(await request('PATCH', { id: targetId, email, role: 'admin' }), 409, { error: 'USER_CONFLICT' });
  const writes = calls.filter(({ method }) => method === 'PATCH');
  assert.deepEqual(writes.map(({ body, params }) => [body.email, params.get('email')]), [
    [email, `eq.${newUser.email}`], [newUser.email, `eq.${email}`],
  ]);
  assert.equal(state.profile.email, state.authEmail);
  assert.equal(state.profile.role, 'worker');
  assert.equal(calls.some(({ method }) => method === 'DEL'), false);
});

test('PATCH informa si solo se guardó el correo y conserva la coherencia entre Auth y profiles', async () => {
  const { request, calls, state } = harness({
    intercept: (call) => call.method === 'PATCH' && call.body.name
      ? Response.json({ code: 'unexpected_failure' }, { status: 500 }) : undefined,
  });
  const email = 'new@example.test';
  await expectResponse(await request('PATCH', { id: targetId, email, name: 'Nuevo nombre' }), 500, {
    error: 'USER_PROFILE_UPDATE_FAILED_AFTER_EMAIL_CHANGE',
  });
  assert.equal(state.authEmail, email);
  assert.equal(state.profile.email, email);
  assert.equal(state.profile.name, newUser.name);
  assert.equal(calls.some(({ method }) => method === 'DEL'), false);
});

test('PATCH admite actualizar un perfil cuyo correo previo era null', async () => {
  const { request, calls, state } = harness({ profileEmail: null });
  const email = 'new@example.test';
  await expectResponse(await request('PATCH', { id: targetId, email }), 200, { ok: true, id: targetId });
  assert.equal(calls.find(({ method }) => method === 'PATCH').params.get('email'), 'is.null');
  assert.equal(state.authEmail, email);
  assert.equal(state.profile.email, email);
});

test('la recuperación permite reintentar un cambio interrumpido después de que termine el intento de Auth', async () => {
  const email = 'new@example.test';
  const { request, supabase, state, calls } = harness({
    intercept: (call) => call.method === 'PUT' && call.body.email === email
      ? Response.json({ message: 'timeout' }, { status: 504 }) : undefined,
  });
  await expectResponse(await request('PATCH', { id: targetId, email }), 500, { error: 'USER_UPDATE_ROLLBACK_FAILED' });
  await expectResponse(await request('PATCH', { id: targetId, email: 'second@example.test' }), 409, {
    error: 'USER_EMAIL_CONFLICT',
  });
  assert.equal(calls.filter(({ method }) => method === 'PUT').length, 1);
  assert.equal(state.authEmail, newUser.email);
  assert.equal(state.profile.email, email);
  assert.equal(calls.some(({ method }) => method === 'DEL'), false);

  // The mocked Auth request is settled and there are no email writers in flight.
  calls.length = 0;
  assert.deepEqual(await reconcileUserEmail(supabase, targetId, { apply: true }), { userId: targetId, status: 'reconciled' });
  assert.equal(state.profile.email, state.authEmail);
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
    ['GET', profilePath], ['GET', authUserPath], ['PATCH', profilePath], ['GET', profilePath], ['GET', authUserPath],
  ]);

  const retryEmail = 'second@example.test';
  await expectResponse(await request('PATCH', { id: targetId, email: retryEmail }), 200, { ok: true, id: targetId });
  assert.equal(state.authEmail, retryEmail);
  assert.equal(state.profile.email, retryEmail);
});

test('la recuperación corrige el perfil cuando PostgreSQL guardó la reserva pero se perdió su respuesta', async () => {
  const email = 'new@example.test';
  let loseResponse = true;
  const { request, supabase, calls, state } = harness({
    afterProfileWrite: (call) => {
      if (loseResponse && call.body.email === email) {
        loseResponse = false;
        throw new TypeError('network response lost after commit');
      }
    },
  });
  await expectResponse(await request('PATCH', { id: targetId, email }), 500, { error: 'INTERNAL_SERVER_ERROR' });
  const reservedVersion = state.profile.updated_at;
  assert.equal(state.profile.email, email);
  assert.equal(state.authEmail, newUser.email);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false);
  await expectResponse(await request('PATCH', { id: targetId, email }), 409, { error: 'USER_EMAIL_CONFLICT' });

  calls.length = 0;
  assert.deepEqual(await reconcileUserEmail(supabase, targetId), { userId: targetId, status: 'mismatch' });
  assert.ok(calls.every(({ method }) => method === 'GET'));
  assert.equal(state.profile.email, email);
  assert.deepEqual(await reconcileUserEmail(supabase, targetId, { apply: true }), { userId: targetId, status: 'reconciled' });
  const recovery = calls.find(({ method }) => method === 'PATCH');
  assert.equal(recovery.params.get('id'), `eq.${targetId}`);
  assert.equal(recovery.params.get('email'), `eq.${email}`);
  assert.equal(recovery.params.get('updated_at'), `eq.${reservedVersion}`);
  assert.deepEqual(Object.keys(recovery.body).sort(), ['email', 'updated_at']);
  assert.ok(Date.parse(state.profile.updated_at) > Date.parse(reservedVersion));
  assert.equal(state.profile.email, newUser.email);
  assert.equal(calls.some(({ method }) => method === 'PUT' || method === 'DEL'), false);

  await expectResponse(await request('PATCH', { id: targetId, email }), 200, { ok: true, id: targetId });
  assert.equal(state.profile.email, email);
  assert.equal(state.authEmail, email);
});

test('la reconciliación rechaza una versión que cambió desde el diagnóstico interno', async () => {
  const pendingEmail = 'pending@example.test';
  const { supabase, calls, state } = harness({
    profileEmail: pendingEmail,
    intercept: (call, state) => {
      if (call.method === 'PATCH') state.profile.updated_at = '2025-01-01T00:00:00.001Z';
    },
  });
  await assert.rejects(reconcileUserEmail(supabase, targetId, { apply: true }), /El perfil cambió desde la lectura/);
  assert.equal(state.profile.email, pendingEmail);
  assert.equal(state.authEmail, newUser.email);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false);
});

test('el diagnóstico confirma el estado si se perdió la respuesta de la propia reconciliación', async () => {
  const { supabase, state, calls } = harness({
    profileEmail: 'pending@example.test',
    afterProfileWrite: () => { throw new TypeError('network response lost after commit'); },
  });
  await assert.rejects(reconcileUserEmail(supabase, targetId, { apply: true }), /No se confirmó la escritura en el perfil/);
  assert.equal(state.profile.email, state.authEmail);

  calls.length = 0;
  assert.deepEqual(await reconcileUserEmail(supabase, targetId), { userId: targetId, status: 'aligned' });
  assert.deepEqual(await reconcileUserEmail(supabase, targetId, { apply: true }), { userId: targetId, status: 'aligned' });
  assert.ok(calls.every(({ method }) => method === 'GET'));
});

test('dos PATCH solapados desde instancias distintas conservan el último correo aplicado en Auth', { timeout: 5000 }, async () => {
  const firstEmail = 'first@example.test';
  const secondEmail = 'second@example.test';
  const firstCommitted = deferred();
  const returnFirstResponse = deferred();
  const { request, createRequestHandler, state } = harness({
    afterAuthWrite: async (call) => {
      if (call.body.email === firstEmail) {
        firstCommitted.resolve();
        await returnFirstResponse.promise;
      }
    },
  });
  const secondRequest = createRequestHandler();

  // Auth applies the first update but delivers its response after the second PATCH completes.
  const first = request('PATCH', { id: targetId, email: firstEmail });
  try {
    await firstCommitted.promise;
    await expectResponse(await secondRequest('PATCH', { id: targetId, email: secondEmail }), 200, { ok: true, id: targetId });
  } finally {
    returnFirstResponse.resolve();
  }
  await expectResponse(await first, 200, { ok: true, id: targetId });
  assert.equal(state.authEmail, secondEmail);
  assert.equal(state.profile.email, secondEmail);
});

test('solo un PATCH puede reservar el correo desde la misma versión del perfil', { timeout: 5000 }, async () => {
  const firstEmail = 'first@example.test';
  const secondEmail = 'second@example.test';
  const firstRead = deferred();
  const resumeFirstClaim = deferred();
  const { request, createRequestHandler, state, calls } = harness({
    intercept: async (call) => {
      if (call.method === 'PATCH' && call.body.email === firstEmail) {
        firstRead.resolve();
        await resumeFirstClaim.promise;
      }
    },
  });
  const secondRequest = createRequestHandler();
  const first = request('PATCH', { id: targetId, email: firstEmail });
  try {
    await firstRead.promise;
    await expectResponse(await secondRequest('PATCH', { id: targetId, email: secondEmail }), 200, { ok: true, id: targetId });
  } finally {
    resumeFirstClaim.resolve();
  }
  await expectResponse(await first, 409, { error: 'USER_EMAIL_CONFLICT' });
  assert.deepEqual(calls.filter(({ method }) => method === 'PUT').map(({ body }) => body.email), [secondEmail]);
  assert.equal(state.authEmail, secondEmail);
  assert.equal(state.profile.email, secondEmail);
});

test('un PATCH atrasado falla aunque el perfil vuelva a mostrar su correo anterior', { timeout: 5000 }, async () => {
  const firstEmail = 'first@example.test';
  const firstRead = deferred();
  const resumeFirstClaim = deferred();
  const originalClaimed = deferred();
  const commitOriginal = deferred();
  const { request, createRequestHandler, state } = harness({
    intercept: async (call) => {
      if (call.method === 'PATCH' && call.body.email === firstEmail) {
        firstRead.resolve();
        await resumeFirstClaim.promise;
      }
      if (call.method === 'PUT' && call.body.email === newUser.email) {
        originalClaimed.resolve();
        await commitOriginal.promise;
      }
    },
  });
  const secondRequest = createRequestHandler();
  const first = request('PATCH', { id: targetId, email: firstEmail });
  let restoreOriginal;
  try {
    await firstRead.promise;
    await expectResponse(await secondRequest('PATCH', { id: targetId, email: 'second@example.test' }), 200, {
      ok: true, id: targetId,
    });
    restoreOriginal = secondRequest('PATCH', { id: targetId, email: newUser.email });
    await originalClaimed.promise;
    assert.equal(state.profile.email, newUser.email);
    resumeFirstClaim.resolve();
    await expectResponse(await first, 409, { error: 'USER_EMAIL_CONFLICT' });
  } finally {
    resumeFirstClaim.resolve();
    commitOriginal.resolve();
  }
  await expectResponse(await restoreOriginal, 200, { ok: true, id: targetId });
  assert.equal(state.authEmail, newUser.email);
  assert.equal(state.profile.email, newUser.email);
});

test('un fallo al listar en Supabase devuelve 500 sin detalles internos', async () => {
  const { request } = harness({
    intercept: (call) => call.path === profilePath && call.params.has('order')
      ? Response.json({ code: 'unexpected_failure', message: 'internal details' }, { status: 500 })
      : undefined,
  });
  await expectResponse(await request('GET'), 500, { error: 'INTERNAL_SERVER_ERROR' });
});

test('sin la columna de REC-01, la autenticación falla de forma cerrada', async () => {
  const { request, calls } = harness({
    intercept: (call) => call.path === profilePath
      ? Response.json({ code: '42703', message: 'column profiles.location_id does not exist' }, { status: 400 })
      : undefined,
  });
  await expectResponse(await request('POST', newUser), 500, { error: 'INTERNAL_SERVER_ERROR' });
  assert.equal(calls.length, 2);
});
