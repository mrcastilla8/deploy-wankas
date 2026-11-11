const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const nextServer = require('next/server');
const ts = require('typescript');
const zod = require('zod');

function loadSource(source, imports, globals = {}) {
  const filename = path.join(__dirname, '../src', source);
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
const supabaseUrl = 'https://supabase.test';
const anonKey = 'test-only-anon-key';
const serviceKey = 'test-only-service-key';
const userId = 'b0403ad6-67f3-42b7-a46d-6586f924a736';
const assignedLocation = '832ed3a4-dfc9-42b9-9975-d88cd5d1aaa6';
const otherLocation = '742dfe10-710c-409f-97fb-478c911d22aa';
const localOrder = { id: 'ce86f30a-96bb-481b-aefc-08b6aa8ed99b', location_id: assignedLocation };
const otherOrder = { id: '637a1931-3f8d-436e-960d-969b73f9782a', location_id: otherLocation };
const validBody = { order_id: localOrder.id, new_status: 'completed' };
const orders = [localOrder, otherOrder];

function harness({ role = 'admin', location = null, ordersError = false, rpc } = {}) {
  const calls = [];
  const invalidations = [];
  const fetchSupabase = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(request);
    switch (url.pathname) {
      case '/auth/v1/user':
        return Response.json({ id: userId, user_metadata: { role: 'admin', location_id: otherLocation } });
      case '/rest/v1/profiles':
        return Response.json([{ role, location_id: location }]);
      case '/rest/v1/orders': {
        if (ordersError) return dbError('XX000', null, 500);
        const filter = url.searchParams.get('location_id');
        return Response.json(filter ? orders.filter((order) => `eq.${order.location_id}` === filter) : orders);
      }
      case '/rest/v1/rpc/transition_order_atomic':
        assert.ok(rpc, 'Unexpected RPC');
        return rpc(request);
      default:
        assert.fail(`Unexpected Supabase request: ${request.url}`);
    }
  };

  const adminClient = {
    createAdminClient: () => createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchSupabase },
    }),
  };
  const adminAuth = loadSource('lib/adminAuth.ts', {
    'server-only': {},
    'next/server': nextServer,
    './supabase/adminClient': adminClient,
  });
  const route = loadSource('app/api/admin/pedidos/route.ts', {
    'next/server': nextServer,
    '@supabase/supabase-js': {
      createClient: (url, key, options) => createClient(url, key, {
        ...options, global: { ...options.global, fetch: fetchSupabase },
      }),
    },
    'zod': zod,
    '@/lib/adminAuth': adminAuth,
    '@/lib/adminRouteCache': {
      invalidateAdminRouteCache: async (resource) => { invalidations.push(resource); },
    },
    '@/lib/supabase/adminClient': adminClient,
  }, {
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } },
  });
  return { ...route, calls, invalidations, paths: () => calls.map((request) => new URL(request.url).pathname) };
}

function dbError(code, hint, status) {
  return Response.json({ code, hint, message: 'Private PostgreSQL error details' }, { status });
}

function request(method, { authenticated = true, query = '', body = JSON.stringify(validBody) } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated) headers.Authorization = 'bearer  current-user-token';
  return new Request(`${apiUrl}${query}`, { method, headers, body: method === 'PATCH' ? body : undefined });
}

async function expectError(response, status, error) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { error });
}

const authPaths = ['/auth/v1/user', '/rest/v1/profiles'];
const rpcPath = '/rest/v1/rpc/transition_order_atomic';

for (const method of ['GET', 'PATCH']) {
  test(`${method}: anonymous requests receive 401 before any Supabase call`, async () => {
    const route = harness();
    const response = await route[method](request(method, { authenticated: false }));
    await expectError(response, 401, 'UNAUTHORIZED');
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.deepEqual(route.paths(), []);
  });

  test(`${method}: workers without a persistent location receive 403`, async () => {
    const route = harness({ role: 'worker' });
    const query = `?role=admin&location_id=${assignedLocation}`;
    await expectError(await route[method](request(method, { query })), 403, 'FORBIDDEN');
    assert.deepEqual(route.paths(), authPaths);
  });
}

test('GET: worker scope comes from public.profiles despite spoofed query parameters', async () => {
  const route = harness({ role: 'worker', location: assignedLocation });
  const response = await route.GET(request('GET', { query: `?role=admin&location_id=${otherLocation}` }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), [localOrder]);
  assert.deepEqual(route.paths(), [...authPaths, '/rest/v1/orders']);
  const profileUrl = new URL(route.calls[1].url);
  assert.equal(profileUrl.searchParams.get('id'), `eq.${userId}`);
  assert.equal(route.calls[1].headers.get('accept-profile'), 'public');
  assert.equal(new URL(route.calls[2].url).searchParams.get('location_id'), `eq.${assignedLocation}`);
});

test('GET: an authorized admin receives the explicit projection across locations', async () => {
  const route = harness({ role: 'admin', location: assignedLocation });
  const response = await route.GET(request('GET', { query: `?role=worker&location_id=${otherLocation}` }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), orders);
  const { searchParams } = new URL(route.calls[2].url);
  assert.equal(searchParams.has('location_id'), false);
  assert.equal(searchParams.get('order'), 'created_at.desc');
  assert.equal(searchParams.get('select'), [
    'id', 'user_id', 'location_id', 'order_date', 'pickup_date', 'status', 'total_price', 'notes',
    'created_at', 'updated_at', 'profiles(name)', 'locations(name_es)', 'order_items(product_id,quantity)',
  ].join(','));
});

test('GET: a Supabase error returns 500 without a success payload or database details', async () => {
  const route = harness({ ordersError: true });
  await expectError(await route.GET(request('GET')), 500, 'INTERNAL_SERVER_ERROR');
});

test('PATCH: a customer receives 403 before invoking the RPC', async () => {
  const route = harness({ role: 'customer' });
  await expectError(await route.PATCH(request('PATCH')), 403, 'FORBIDDEN');
  assert.deepEqual(route.paths(), authPaths);
});

test('PATCH: malformed bodies, invalid states and additional keys return 400', async () => {
  const invalidBodies = [
    '{',
    'null',
    JSON.stringify([validBody]),
    JSON.stringify({ order_id: localOrder.id }),
    JSON.stringify({ ...validBody, order_id: 'bad-id' }),
    JSON.stringify({ ...validBody, new_status: 'pending' }),
    JSON.stringify({ ...validBody, role: 'admin', location_id: otherLocation, userId }),
  ];
  for (const body of invalidBodies) {
    const route = harness();
    await expectError(await route.PATCH(request('PATCH', { body })), 400, 'INVALID_REQUEST');
    assert.deepEqual(route.paths(), authPaths);
  }
});

test('PATCH: the RPC receives the worker token and denies an order outside the worker location', async () => {
  const route = harness({
    role: 'worker',
    location: assignedLocation,
    rpc: async (req) => {
      assert.equal(req.headers.get('authorization'), 'Bearer current-user-token');
      assert.equal(req.headers.get('apikey'), anonKey);
      assert.deepEqual(await req.json(), { order_id: otherOrder.id, new_status: 'completed' });
      return dbError('42501', 'SIN_PERMISO', 403);
    },
  });
  const response = await route.PATCH(request('PATCH', {
    query: `?role=admin&location_id=${otherLocation}`,
    body: JSON.stringify({ ...validBody, order_id: otherOrder.id }),
  }));
  await expectError(response, 403, 'FORBIDDEN');
  assert.deepEqual(route.paths(), [...authPaths, rpcPath]);
});

test('PATCH: an out-of-scope and a missing order return identical responses to a worker', async () => {
  const route = harness({
    role: 'worker',
    location: assignedLocation,
    rpc: async (req) => {
      const { order_id } = await req.json();
      return order_id === otherOrder.id
        ? dbError('42501', 'SIN_PERMISO', 403)
        : dbError('22023', 'PEDIDO_NO_ENCONTRADO', 400);
    },
  });
  const outsideScope = await route.PATCH(request('PATCH', {
    body: JSON.stringify({ ...validBody, order_id: otherOrder.id }),
  }));
  const missing = await route.PATCH(request('PATCH', {
    body: JSON.stringify({ ...validBody, order_id: 'c0954d76-76af-4bbf-87e9-439e7aa78912' }),
  }));
  assert.deepEqual([...outsideScope.headers], [...missing.headers]);
  await expectError(outsideScope, 403, 'FORBIDDEN');
  await expectError(missing, 403, 'FORBIDDEN');
  assert.deepEqual(route.invalidations, []);
});

for (const [code, hint, upstreamStatus, status, error] of [
  ['28000', 'NO_AUTENTICADO', 403, 401, 'UNAUTHORIZED'],
  ['PGRST301', null, 401, 401, 'UNAUTHORIZED'],
  ['23514', 'TRANSICION_INVALIDA', 400, 409, 'ORDER_TRANSITION_CONFLICT'],
  ['22023', 'PEDIDO_NO_ENCONTRADO', 400, 404, 'ORDER_NOT_FOUND'],
  ['PGRST202', null, 404, 500, 'INTERNAL_SERVER_ERROR'],
  ['XX000', null, 500, 500, 'INTERNAL_SERVER_ERROR'],
]) {
  test(`PATCH: RPC error ${hint ?? code} returns ${status} without publishing success`, async () => {
    const route = harness({ rpc: () => dbError(code, hint, upstreamStatus) });
    await expectError(await route.PATCH(request('PATCH')), status, error);
    assert.deepEqual(route.paths(), [...authPaths, rpcPath]);
    assert.deepEqual(route.invalidations, []);
  });
}

test('PATCH: a matching completion invalidates only the dashboard', async () => {
  const result = { order_id: localOrder.id, status: 'completed' };
  for (const payload of [result, [result]]) {
    const route = harness({ rpc: (req) => {
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.get('authorization'), 'Bearer current-user-token');
      assert.deepEqual(route.invalidations, []);
      return Response.json(payload);
    } });
    const response = await route.PATCH(request('PATCH'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), result);
    assert.deepEqual(route.paths(), [...authPaths, rpcPath]);
    assert.deepEqual(route.invalidations, ['dashboard']);
  }
  for (const payload of [null, [], [result, result], { ...result, status: 'cancelled' }]) {
    const route = harness({ rpc: () => Response.json(payload) });
    await expectError(await route.PATCH(request('PATCH')), 500, 'INTERNAL_SERVER_ERROR');
    assert.deepEqual(route.invalidations, []);
  }
});

test('PATCH: a successful cancellation invalidates the catalog and dashboard via the catalog scope', async () => {
  const body = { order_id: localOrder.id, new_status: 'cancelled' };
  const result = { order_id: localOrder.id, status: 'cancelled' };
  const route = harness({
    rpc: async (req) => {
      assert.deepEqual(await req.json(), body);
      assert.deepEqual(route.invalidations, []);
      return Response.json(result);
    },
  });
  const response = await route.PATCH(request('PATCH', { body: JSON.stringify(body) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(route.paths(), [...authPaths, rpcPath]);
  assert.deepEqual(route.invalidations, ['catalogo']);
});
