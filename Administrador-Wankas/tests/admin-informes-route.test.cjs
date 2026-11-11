const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const nextServer = require('next/server');
const ts = require('typescript');

function loadSource(source, imports, globals = {}) {
  const filename = path.join(__dirname, '../src', source);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  });
  const exports = {};
  compileFunction(outputText, ['require', 'exports', ...Object.keys(globals)], { filename })(
    (id) => { assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`); return imports[id]; },
    exports, ...Object.values(globals),
  );
  return exports;
}

const url = 'https://panel.test/api/admin/informes';
const userId = 'b0403ad6-67f3-42b7-a46d-6586f924a736';
const orders = [
  { id: '11111111-1111-4111-8111-111111111111', order_date: '2026-11-01T12:00:00Z', status: 'completed', total_price: 20,
    locations: { name_es: 'Lima' }, order_items: [{ quantity: 2, price_at_purchase: 10, products: { name_es: 'Papa', categories: { name_es: 'Verduras' } } }] },
  { id: '22222222-2222-4222-8222-222222222222', order_date: '2026-11-02T12:00:00Z', status: 'completed', total_price: 5,
    locations: { name_es: 'Lima' }, order_items: [{ quantity: 1, price_at_purchase: 5, products: { name_es: 'Pan', categories: null } }] },
];
const products = [
  { id: '33333333-3333-4333-8333-333333333333', name_es: 'Papa', stock: 4 },
  { id: '44444444-4444-4444-8444-444444444444', name_es: 'Pan', stock: 30 },
];

function harness({ role = 'admin', orderRows = orders, productRows = products, fail } = {}) {
  const calls = [];
  const fetchMock = async (input, init) => {
    const request = new Request(input, init);
    const parsed = new URL(request.url);
    calls.push(request);
    if (parsed.pathname === '/auth/v1/user') return Response.json({ id: userId });
    if (parsed.pathname === '/rest/v1/profiles') return Response.json([{ role, location_id: null }]);
    const table = parsed.pathname.split('/').at(-1);
    if (fail?.(table, parsed)) return Response.json({ code: 'XX000', message: 'private database details' }, { status: 500 });
    assert.ok(['orders', 'products'].includes(table), `Unexpected table ${table}`);
    const rows = table === 'orders' ? orderRows : productRows;
    const after = parsed.searchParams.get('id')?.slice('gt.'.length) ?? '';
    const limit = Math.min(Number(parsed.searchParams.get('limit')), 1);
    return Response.json(rows.filter((row) => row.id > after).slice(0, limit));
  };
  const client = { createAdminClient: () => createClient('https://supabase.test', 'test-service-key', {
    auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: fetchMock },
  }) };
  const auth = loadSource('lib/adminAuth.ts', { 'server-only': {}, 'next/server': nextServer, './supabase/adminClient': client });
  const pagination = loadSource('lib/adminPagination.ts', {});
  const route = loadSource('app/api/admin/informes/route.ts', {
    'next/server': nextServer, '@/lib/adminAuth': auth, '@/lib/adminPagination': pagination,
    '@/lib/supabase/adminClient': client,
  }, { process: { env: {} } });
  return { ...route, calls, paths: () => calls.map((call) => new URL(call.url).pathname) };
}

const request = (authenticated = true) => new Request(url, { headers: authenticated ? { Authorization: 'Bearer current-user-token' } : {} });

test('informes: anónimo recibe 401 antes de consultar tablas', async () => {
  const route = harness();
  const response = await route.GET(request(false));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(route.paths(), []);
});

test('informes: worker recibe 403 antes de leer informes', async () => {
  const route = harness({ role: 'worker' });
  const response = await route.GET(request());
  assert.equal(response.status, 403);
  assert.deepEqual(route.paths(), ['/auth/v1/user', '/rest/v1/profiles']);
});

test('informes: admin obtiene cada página, usa importes históricos y no consulta PII', async () => {
  const route = harness();
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  assert.deepEqual(body.orders, orders);
  assert.deepEqual(body.products, products);
  assert.equal(body.orders[0].order_items[0].quantity * body.orders[0].order_items[0].price_at_purchase, 20);
  const dataCalls = route.calls.slice(2);
  assert.ok(dataCalls.length >= 6, 'Lectura con dos páginas por tabla');
  const selects = dataCalls.map((call) => new URL(call.url).searchParams.get('select'));
  assert.ok(selects.every((select) => !/user_id|email|phone|address|profiles/.test(select)));
  assert.ok(selects.some((select) => select.includes('price_at_purchase')));
});

test('informes: tablas vacías devuelven éxito realmente vacío', async () => {
  const route = harness({ orderRows: [], productRows: [] });
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { orders: [], products: [] });
});

test('informes: falla sin publicar resultados parciales si falla primera o segunda página', async (t) => {
  for (const [name, fail] of [
    ['primera página', (table, parsed) => table === 'orders' && !parsed.searchParams.has('id')],
    ['página posterior', (table, parsed) => table === 'orders' && parsed.searchParams.has('id')],
  ]) {
    await t.test(name, async () => {
      const route = harness({ fail });
      const response = await route.GET(request());
      assert.equal(response.status, 500);
      const body = await response.text();
      assert.deepEqual(JSON.parse(body), { error: 'INTERNAL_SERVER_ERROR' });
      assert.doesNotMatch(body, /private database details/);
    });
  }
});
