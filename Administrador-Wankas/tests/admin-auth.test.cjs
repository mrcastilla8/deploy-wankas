const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const { NextResponse } = require('next/server');
const ts = require('typescript');

// Run the production helpers without a Next build or real Supabase credentials.
function loadHelper(name, imports, globals = {}) {
  const filename = path.join(__dirname, '../src/lib', `${name}.ts`);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  const exports = {};
  const load = compileFunction(outputText, ['require', 'exports', ...Object.keys(globals)], { filename });
  load((id) => {
    assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
    return imports[id];
  }, exports, ...Object.values(globals));
  return exports;
}

const apiUrl = 'https://panel.test/api/admin/pedidos';
const userId = '390eb33d-6dd7-4ae6-88e7-a15f186ed641';
const locationId = 'e90e2d78-ec91-4a4a-a760-4743cba523dc';
const serviceKey = 'test-only-service-key';

function serverHarness({ role, location = null, authStatus = 200, dbError = false } = {}) {
  const calls = [];
  const supabaseFetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    switch (new URL(request.url).pathname) {
      case '/auth/v1/user':
        return authStatus === 200
          ? Response.json({ id: userId, user_metadata: { role: 'admin', location_id: 'untrusted' } })
          : Response.json({ code: 'bad_jwt', message: 'Auth error details' }, { status: authStatus });
      case '/rest/v1/profiles':
        return dbError
          ? Response.json({ code: '42703', message: 'Column details' }, { status: 400 })
          : Response.json(role === undefined ? [] : [{ role, location_id: location }]);
      default:
        throw new Error(`Unexpected Supabase URL: ${request.url}`);
    }
  };
  const { authenticateAdmin } = loadHelper('adminAuth', {
    'server-only': {}, // Next resolves this marker in server builds.
    'next/server': { NextResponse },
    './supabase/adminClient': {
      createAdminClient: () => createClient('https://supabase.test', serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: supabaseFetch },
      }),
    },
  });
  return { authenticateAdmin, calls };
}

async function expectFailure(result, status, error) {
  assert.equal(result.ok, false);
  assert.ok(result.response instanceof NextResponse);
  assert.equal(result.response.status, status);
  assert.deepEqual(await result.response.json(), { error });
}

for (const [name, authorization] of [
  ['missing token', undefined],
  ['wrong authorization scheme', 'Basic opaque'],
  ['empty Bearer token', 'Bearer'],
  ['multiple credentials', 'Bearer one, Bearer two'],
]) {
  test(`${name}: 401 without contacting Supabase`, async () => {
    const { authenticateAdmin, calls } = serverHarness();
    const headers = authorization === undefined ? {} : { Authorization: authorization };
    await expectFailure(await authenticateAdmin(new Request(apiUrl, { headers })), 401, 'UNAUTHORIZED');
    assert.equal(calls.length, 0);
  });
}

test('invalid token: 401 from Auth, without querying profiles', async () => {
  const { authenticateAdmin, calls } = serverHarness({ authStatus: 403 });
  const request = new Request(apiUrl, { headers: { Authorization: 'Bearer invalid' } });
  await expectFailure(await authenticateAdmin(request), 401, 'UNAUTHORIZED');
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ['/auth/v1/user']);
  assert.equal(calls[0].headers.get('authorization'), 'Bearer invalid');
});

for (const [name, role] of [['missing profile', undefined], ['customer', 'customer']]) {
  test(`${name}: 403 even when user_metadata.role is admin`, async () => {
    const { authenticateAdmin } = serverHarness({ role });
    const request = new Request(apiUrl, { headers: { Authorization: 'Bearer valid' } });
    await expectFailure(await authenticateAdmin(request), 403, 'FORBIDDEN');
  });
}

for (const [role, location] of [['worker', locationId], ['admin', null]]) {
  test(`${role}: derives the principal from Auth and public.profiles`, async () => {
    const { authenticateAdmin, calls } = serverHarness({ role, location });
    const spoofed = { userId: 'fake-user', role: 'customer', location_id: 'fake-location' };
    const request = new Request(`${apiUrl}?${new URLSearchParams(spoofed)}`, {
      method: 'POST',
      body: JSON.stringify(spoofed),
      headers: { Authorization: 'bearer valid', 'X-User-Id': spoofed.userId, 'X-Role': spoofed.role },
    });
    assert.deepEqual(await authenticateAdmin(request), { ok: true, principal: { userId, role, locationId: location } });

    const [authRequest, profileRequest] = calls;
    assert.equal(authRequest.headers.get('authorization'), 'Bearer valid');
    const profileUrl = new URL(profileRequest.url);
    assert.equal(profileUrl.pathname, '/rest/v1/profiles');
    assert.equal(profileUrl.searchParams.get('id'), `eq.${userId}`);
    assert.equal(profileRequest.headers.get('accept-profile'), 'public');
    assert.equal(profileRequest.headers.get('authorization'), `Bearer ${serviceKey}`);
    assert.equal(request.bodyUsed, false);
  });
}

test('unexpected profile query failure: 500 without exposing database details', async () => {
  const { authenticateAdmin } = serverHarness({ dbError: true });
  const request = new Request(apiUrl, { headers: { Authorization: 'Bearer valid' } });
  await expectFailure(await authenticateAdmin(request), 500, 'INTERNAL_SERVER_ERROR');
});

function clientHarness(session, fetch) {
  return loadHelper('adminFetch', {
    './supabase/client': { createClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }) },
  }, { fetch, window: { location: new URL('https://panel.test/dashboard') } });
}

test('adminFetch: no session returns a distinguishable 401 without a fetch', async () => {
  const { adminFetch } = clientHarness(null, () => assert.fail('Unexpected fetch'));
  const result = await adminFetch('/api/admin/pedidos', { headers: { Authorization: 'Bearer supplied' } });
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { error: 'NO_ADMIN_SESSION' });
});

test('adminFetch: preserves the request and passes through all required error responses', async () => {
  const headers = new Headers({ 'content-type': 'application/json', authorization: 'Bearer supplied' });
  const body = JSON.stringify({ status: 'completed' });
  const signal = new AbortController().signal;
  for (const status of [401, 403, 400, 409, 500]) {
    const response = Response.json({ status }, { status });
    const { adminFetch } = clientHarness({ access_token: 'current' }, (target, init) => {
      assert.equal(String(target), apiUrl);
      assert.equal(init.method, 'PATCH');
      assert.equal(init.body, body);
      assert.equal(init.signal, signal);
      assert.equal(init.headers.get('content-type'), 'application/json');
      assert.equal(init.headers.get('authorization'), 'Bearer current');
      return Promise.resolve(response);
    });
    assert.equal(await adminFetch('/api/admin/pedidos', { method: 'PATCH', headers, body, signal }), response);
    assert.equal(headers.get('authorization'), 'Bearer supplied');
  }
});

test('adminFetch: never forwards the session token to another origin', async () => {
  const { adminFetch } = clientHarness({ access_token: 'current' }, () => assert.fail('Unexpected fetch'));
  await assert.rejects(adminFetch('//external.test/api/admin'), TypeError);
});
