const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const ts = require('typescript');

const compiled = new Map();
function load(name, imports, globals = {}) {
  if (!compiled.has(name)) {
    const filename = path.join(__dirname, '../src', `${name}.ts`);
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: filename,
    });
    compiled.set(name, { filename, outputText });
  }
  const { filename, outputText } = compiled.get(name);
  const exports = {};
  const run = compileFunction(outputText, ['require', 'exports', ...Object.keys(globals)], { filename });
  run((id) => Object.hasOwn(imports, id) ? imports[id] : require(id), exports, ...Object.values(globals));
  return exports;
}

const id = '390eb33d-6dd7-4ae6-88e7-a15f186ed641';
const categoryId = 'e90e2d78-ec91-4a4a-a760-4743cba523dc';
const product = { name_es: 'Bloque', description_es: 'Gris', price: 12.5, stock: 0, category_id: categoryId };
const location = { name_es: 'Sede central', address: 'Av. Arequipa 2345' };
const category = { id: categoryId, name_es: 'Construcción' };
const recent = { id, total_price: 25.5, status: 'completed', profiles: { name: 'Ana' }, locations: { name_es: 'Sede central' } };
const revenueColumns = 'id,total_price';
const resources = [
  ['catalogo', 'products', product],
  ['ubicaciones', 'locations', location],
];
const dashboard = { stats: { totalOrders: 1, totalRevenue: 25.5, activeProducts: 0, activeLocations: 0 }, recentOrders: [recent] };

// Exercise the real auth helper, route handlers and Supabase client without network calls.
function harness({ orders = [recent], revenueLimit = Infinity } = {}) {
  const routes = {};
  const events = [];
  const redis = new Map();
  const rows = {
    products: new Map(),
    locations: new Map(),
    orders: new Map(orders.map((order) => [order.id, order])),
  };
  const faults = {};
  const dataCalls = [];

  class Redis {
    on() {}
    async get(key) {
      events.push(['get', key]);
      if (faults.redisRead) throw new Error('Redis unavailable');
      return redis.get(key) ?? null;
    }
    async set(key, value, option, ttl) {
      events.push(['set', key, option, ttl]);
      if (faults.redisWrite) throw new Error('Redis unavailable');
      if (option === 'NX' && redis.has(key)) return null;
      redis.set(key, value);
      return 'OK';
    }
    async mset(...entries) {
      events.push(['mset', ...entries]);
      if (faults.redisWrite) throw new Error('Redis unavailable');
      for (let index = 0; index < entries.length; index += 2) {
        redis.set(entries[index], entries[index + 1]);
      }
      return 'OK';
    }
  }

  const adminRouteCache = load('lib/adminRouteCache', { 'server-only': {}, ioredis: Redis }, {
    process: { env: { REDIS_URL: 'redis://test.invalid' } },
    console: { warn() {} },
  });
  let role;
  const supabaseFetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/user') {
      role = request.headers.get('authorization').slice('Bearer '.length);
      events.push(['auth', role]);
      return Response.json({ id, user_metadata: { role: 'admin' } });
    }
    if (url.pathname === '/rest/v1/profiles') {
      events.push(['profile', role]);
      return Response.json([{ role, location_id: null }]);
    }

    const table = url.pathname.split('/').pop();
    const columns = url.searchParams.get('select');
    dataCalls.push({ table, columns, method: request.method, url, request });
    events.push(['db', table, request.method]);
    if (faults.db?.(table, request.method, columns, url)) {
      const code = faults.dbCode ?? 'XX000';
      return request.method === 'HEAD'
        ? new Response(null, { status: 500 })
        : Response.json({ code, message: 'Database error details' }, { status: code === '23503' ? 409 : 500 });
    }

    if (request.method === 'HEAD') {
      const count = rows[table]?.size ?? 1;
      return new Response(null, { headers: { 'Content-Range': count ? `0-${count - 1}/${count}` : '*/0' } });
    }
    if (request.method === 'GET') {
      if (table === 'categories') return Response.json([category]);
      if (table === 'orders') {
        const orders = [...rows.orders.values()];
        if (columns !== revenueColumns) return Response.json(orders.slice(0, 5));

        assert.equal(url.searchParams.get('status'), 'eq.completed');
        assert.equal(url.searchParams.get('order'), 'id.asc');
        const cursor = url.searchParams.get('id')?.slice('gt.'.length) ?? '';
        const limit = Math.min(Number(url.searchParams.get('limit')), revenueLimit);
        const page = orders
          .filter((order) => order.status === 'completed' && order.id > cursor)
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(0, limit)
          .map(({ id, total_price }) => ({ id, total_price }));
        return Response.json(page);
      }
      const snapshot = [...rows[table].values()];
      await faults.pauseRead?.(table);
      return Response.json(snapshot);
    }

    const filter = url.searchParams.get('id');
    assert.equal(filter, request.method === 'POST' ? null : `eq.${id}`);
    if (request.method !== 'POST' && !rows[table].has(id)) return Response.json([]);
    if (request.method === 'DELETE') {
      rows[table].delete(id);
    } else {
      rows[table].set(id, { id, ...rows[table].get(id), ...await request.json() });
    }
    return Response.json([{ id }], { status: request.method === 'POST' ? 201 : 200 });
  };
  const supabase = {
    createAdminClient: () => createClient('https://supabase.test', 'test-service-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: supabaseFetch },
    }),
  };
  const adminAuth = load('lib/adminAuth', { 'server-only': {}, './supabase/adminClient': supabase });

  for (const resource of ['catalogo', 'ubicaciones', 'dashboard']) {
    routes[resource] = load(`app/api/admin/${resource}/route`, {
      '@/lib/adminAuth': adminAuth,
      '@/lib/adminRouteCache': adminRouteCache,
      '@/lib/supabase/adminClient': supabase,
    });
  }

  function call(resource, { method = 'GET', token = 'admin', body, rawBody } = {}) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return routes[resource][method](new Request(`https://panel.test/api/admin/${resource}?role=admin`, {
      method,
      headers,
      body: rawBody ?? JSON.stringify(body),
    }));
  }

  return { call, dataCalls, events, faults, redis, routes, rows, invalidate: adminRouteCache.invalidateAdminRouteCache };
}

async function expectJson(response, status, data) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), data);
}

for (const resource of ['catalogo', 'ubicaciones', 'dashboard']) {
  test(`${resource}: anonymous GET with a warm cache returns 401 without touching Redis`, async () => {
    const { call, events, redis } = harness();
    assert.equal((await call(resource)).status, 200);
    assert.ok(redis.size > 0);
    events.length = 0;
    const response = await call(resource, { token: null });
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    await expectJson(response, 401, { error: 'UNAUTHORIZED' });
    assert.deepEqual(events, []);
  });

  test(`${resource}: Redis read failure falls back to Supabase`, async () => {
    const { call, faults, dataCalls } = harness();
    const initial = await (await call(resource)).json();
    faults.redisRead = true;
    dataCalls.length = 0;
    await expectJson(await call(resource), 200, initial);
    assert.ok(dataCalls.length > 0);
  });
}

for (const [resource, table, fields] of resources) {
  test(`${resource}: worker reads the projected data in its own cache scope`, async () => {
    const { call, events, dataCalls, rows } = harness();
    const row = { id, ...fields };
    rows[table].set(id, table === 'products' ? { ...row, categories: { name_es: category.name_es } } : row);
    const expected = table === 'products'
      ? { products: [...rows[table].values()], categories: [category] }
      : [row];
    await expectJson(await call(resource), 200, expected);

    events.length = 0;
    dataCalls.length = 0;
    await expectJson(await call(resource, { token: 'worker' }), 200, expected);
    assert.deepEqual(events.slice(0, 2), [['auth', 'worker'], ['profile', 'worker']]);
    assert.ok(events.some(([operation, key]) => operation === 'get' && key.includes(':worker:')));
    assert.ok(!events.some(([operation, key]) => operation === 'get' && key.includes(':admin:')));
    assert.deepEqual(dataCalls.map(({ table, columns }) => [table, columns]), table === 'products'
      ? [['products', 'id,name_es,description_es,price,stock,category_id,categories(name_es)'], ['categories', 'id,name_es']]
      : [['locations', 'id,name_es,address']]);

    dataCalls.length = 0;
    await expectJson(await call(resource, { token: 'worker' }), 200, expected);
    assert.equal(dataCalls.length, 0);
  });

  test(`${resource}: anonymous, worker and customer cannot mutate`, async () => {
    const { call, events } = harness();
    for (const token of [null, 'worker', 'customer']) {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        const body = method === 'DELETE' ? { id } : { id, ...fields };
        const response = await call(resource, { method, token, body });
        await expectJson(response, token ? 403 : 401, { error: token ? 'FORBIDDEN' : 'UNAUTHORIZED' });
      }
    }
    assert.ok(events.every(([operation]) => operation === 'auth' || operation === 'profile'));
  });

  test(`${resource}: admin can create and update, invalidating both roles and dashboard`, async () => {
    const { call, dataCalls, events, rows } = harness();
    for (const [method, status, body] of [
      ['POST', 201, { ...fields, name_en: 'ignored' }],
      ['PATCH', 200, table === 'products'
        ? { id, name_es: 'Actualizado' }
        : { id, ...fields, name_es: 'Actualizado' }],
    ]) {
      await call(resource);
      await call(resource, { token: 'worker' });
      await call('dashboard');
      events.length = 0;
      dataCalls.length = 0;
      await expectJson(await call(resource, { method, body }), status, { id });
      assert.deepEqual(events.map(([op]) => op), ['auth', 'profile', 'db', 'mset']);
      assert.equal(dataCalls[0].columns, 'id');
      assert.equal(dataCalls[0].table, table);

      const payload = [...rows[table].values()];
      assert.deepEqual(payload, [{ id, ...fields, name_es: body.name_es }]);

      for (const token of ['admin', 'worker']) {
        dataCalls.length = 0;
        await expectJson(await call(resource, { token }), 200,
          table === 'products' ? { products: payload, categories: [category] } : payload);
        assert.ok(dataCalls.some((entry) => entry.table === table));
      }
      const metric = table === 'products' ? 'activeProducts' : 'activeLocations';
      await expectJson(await call('dashboard'), 200, { ...dashboard, stats: { ...dashboard.stats, [metric]: payload.length } });
    }
  });

  test(`${resource}: invalid JSON and invalid payloads return 400 before DB and Redis`, async () => {
    const { call, dataCalls, events } = harness();
    for (const [method, body, rawBody] of [
      ['POST', null, '{'],
      ['POST', { ...fields, name_es: ' ' }],
      ['PATCH', fields],
      ['DELETE', { id: 'not-uuid' }],
      ['DELETE'],
    ]) {
      await expectJson(await call(resource, { method, body, rawBody }), 400, { error: 'INVALID_INPUT' });
    }
    assert.equal(dataCalls.length, 0);
    assert.ok(events.every(([operation]) => operation === 'auth' || operation === 'profile'));
  });

  test(`${resource}: admin delete is blocked before reaching DB or Redis`, async () => {
    const { call, events, rows } = harness();
    rows[table].set(id, { id, ...fields });
    await call(resource);
    events.length = 0;
    await expectJson(await call(resource, { method: 'DELETE', body: { id } }), 409, { error: 'DELETE_BLOCKED' });
    assert.deepEqual(events.map(([op]) => op), ['auth', 'profile']);
    assert.deepEqual(rows[table].get(id), { id, ...fields });
  });

  test(`${resource}: DB mutation failure or missing target never invalidates the cache`, async () => {
    const { call, events, faults } = harness();
    faults.db = (name, method) => name === table && method === 'POST';
    await expectJson(await call(resource, { method: 'POST', body: fields }), 500, { error: 'INTERNAL_SERVER_ERROR' });
    const body = table === 'products' ? { id, name_es: fields.name_es } : { ...fields, id };
    await expectJson(await call(resource, { method: 'PATCH', body }), 404, { error: 'NOT_FOUND' });
    assert.ok(!events.some(([op]) => op === 'mset'));
  });
}

test('catalogo: a metadata edit preserves a stock reservation made after the form loaded', async () => {
  const { call, dataCalls, rows } = harness();
  rows.products.set(id, { ...product, id, stock: 10 });
  const { products: [form] } = await (await call('catalogo')).json();
  rows.products.set(id, { ...rows.products.get(id), stock: 8 });

  await expectJson(await call('catalogo', { method: 'PATCH', body: { id, stock: form.stock, name_es: 'Actualizado' } }),
    400, { error: 'INVALID_INPUT' });
  await expectJson(await call('catalogo', { method: 'PATCH', body: { id } }), 400, { error: 'INVALID_INPUT' });
  assert.ok(!dataCalls.some(({ method }) => method === 'PATCH'));

  await expectJson(await call('catalogo', { method: 'PATCH', body: { id, name_es: 'Actualizado' } }), 200, { id });
  await expectJson(await call('catalogo'), 200, {
    products: [{ ...product, id, name_es: 'Actualizado', stock: 8 }],
    categories: [category],
  });
});

test('catalogo: a category FK conflict returns 409 and leaves the cached generation intact', async () => {
  const { call, events, faults } = harness();
  faults.db = (table, method) => table === 'products' && method === 'POST';
  faults.dbCode = '23503';
  await expectJson(await call('catalogo', { method: 'POST', body: product }), 409, { error: 'INTEGRITY_CONFLICT' });
  assert.deepEqual(events.map(([op]) => op), ['auth', 'profile', 'db']);
});

test('catalogo: rejects invalid prices, stock and category IDs', async () => {
  const { call, dataCalls } = harness();
  for (const changes of [{ price: '12.50' }, { price: 0 }, { stock: -1 }, { stock: 0.5 }, { stock: 2 ** 31 }, { category_id: 'invalid' }]) {
    await expectJson(await call('catalogo', { method: 'POST', body: { ...product, ...changes } }), 400, { error: 'INVALID_INPUT' });
  }
  assert.equal(dataCalls.length, 0);
});

for (const [resource, table, method, columns] of [
  ['catalogo', 'products', 'GET'],
  ['catalogo', 'categories', 'GET'],
  ['ubicaciones', 'locations', 'GET'],
  ['dashboard', 'orders', 'HEAD'],
  ['dashboard', 'orders', 'GET', revenueColumns],
  ['dashboard', 'products', 'HEAD'],
  ['dashboard', 'locations', 'HEAD'],
  ['dashboard', 'orders', 'GET', 'id,total_price,status,profiles(name),locations(name_es)'],
]) {
  const query = columns ? `${method} ${table} (${columns})` : `${method} ${table}`;
  test(`${resource}: ${query} DB failure yields 500 and no cached payload`, async () => {
    const { call, events, faults } = harness();
    faults.db = (name, verb, select) => table === name && method === verb && (!columns || columns === select);
    await expectJson(await call(resource), 500, { error: 'INTERNAL_SERVER_ERROR' });
    assert.ok(!events.some(([op, , option]) => op === 'set' && option === 'EX'));
  });
}

test('dashboard: a warm admin cache is inaccessible to worker or customer, and DELETE is absent', async () => {
  const { call, dataCalls, events, routes } = harness();
  await expectJson(await call('dashboard'), 200, dashboard);
  assert.ok(dataCalls.every(({ columns }) => !columns.includes('*')));
  assert.equal(dataCalls.find(({ columns }) => columns === revenueColumns).url.searchParams.get('status'), 'eq.completed');
  assert.equal(dataCalls.find(({ columns }) => columns.includes('profiles')).url.searchParams.get('limit'), '5');
  events.length = 0;
  for (const token of ['worker', 'customer']) {
    await expectJson(await call('dashboard', { token }), 403, { error: 'FORBIDDEN' });
  }
  assert.ok(events.every(([op]) => op === 'auth' || op === 'profile'));
  assert.equal(routes.dashboard.DELETE, undefined);
});

test('dashboard: total revenue includes every completed order beyond a capped first page', async () => {
  const orderId = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const completed = Array.from({ length: 1003 }, (_, index) => ({
    id: orderId(index + 1), total_price: 0.25, status: 'completed',
  }));
  const pending = { id: orderId(1004), total_price: 900, status: 'pending' };
  const { call, dataCalls } = harness({ orders: [...completed, pending], revenueLimit: 200 });
  await expectJson(await call('dashboard'), 200, {
    stats: { ...dashboard.stats, totalOrders: 1004, totalRevenue: 250.75 },
    recentOrders: completed.slice(0, 5),
  });
  const cursors = dataCalls.filter(({ columns }) => columns === revenueColumns)
    .map(({ url }) => url.searchParams.get('id'));
  assert.deepEqual(cursors, [null, ...[200, 400, 600, 800, 1000, 1003].map((index) => `gt.${orderId(index)}`)]);
});

test('dashboard: a later revenue page failure returns 500 without caching a subtotal', async () => {
  const { call, events, faults } = harness();
  faults.db = (table, method, columns, url) => columns === revenueColumns && url.searchParams.has('id');
  await expectJson(await call('dashboard'), 500, { error: 'INTERNAL_SERVER_ERROR' });
  assert.ok(!events.some(([op, , option]) => op === 'set' && option === 'EX'));
});

test('dashboard: a dashboard-only invalidation reloads order metrics and keeps the catalog cache', async () => {
  const pending = { ...recent, status: 'pending' };
  const { call, dataCalls, rows, invalidate } = harness({ orders: [pending] });
  await call('catalogo');
  await expectJson(await call('dashboard'), 200, {
    stats: { ...dashboard.stats, totalRevenue: 0 }, recentOrders: [pending],
  });
  rows.orders.set(id, recent);
  await invalidate('dashboard');
  await expectJson(await call('dashboard'), 200, dashboard);
  dataCalls.length = 0;
  assert.equal((await call('catalogo')).status, 200);
  assert.equal(dataCalls.length, 0);
});

test('catalogo: an older in-flight read cannot repopulate the cache after invalidation', async () => {
  const { call, faults, rows } = harness();
  rows.products.set(id, { id, ...product });
  let markReady;
  let resume;
  const ready = new Promise((resolve) => { markReady = resolve; });
  const release = new Promise((resolve) => { resume = resolve; });
  faults.pauseRead = async (table) => {
    if (table !== 'products') return;
    markReady();
    await release;
  };
  const pendingRead = call('catalogo');
  await ready;
  try {
    await expectJson(await call('catalogo', { method: 'PATCH', body: { id, name_es: 'Actualizado' } }), 200, { id });
  } finally {
    resume();
  }
  await expectJson(await pendingRead, 200, { products: [{ id, ...product }], categories: [category] });
  await expectJson(await call('catalogo'), 200, {
    products: [{ id, ...product, name_es: 'Actualizado' }], categories: [category],
  });
});

test('ubicaciones: a Redis outage does not report a committed mutation as failed', async () => {
  const { call, faults } = harness();
  faults.redisWrite = true;
  await expectJson(await call('ubicaciones', { method: 'POST', body: location }), 201, { id });
  faults.redisRead = true;
  await expectJson(await call('ubicaciones'), 200, [{ id, ...location }]);
});
