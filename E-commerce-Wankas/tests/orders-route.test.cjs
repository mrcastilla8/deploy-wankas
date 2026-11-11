const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compileFunction } = require('node:vm');
const nextServer = require('next/server');
const ts = require('typescript');

const filename = path.join(__dirname, '../src/app/api/orders/route.ts');
const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
});
const route = {};
compileFunction(outputText, ['require', 'exports'], { filename })((id) => {
  assert.equal(id, 'next/server', 'The retired route must not import a cache or database client');
  return nextServer;
}, route);

for (const method of ['GET', 'POST', 'DELETE']) {
  test(`${method} /api/orders cannot access browser-supplied orders by userId`, async () => {
    const request = new Request('https://shop.test/api/orders?userId=another-user', {
      method,
      body: method === 'POST' ? JSON.stringify({ userId: 'another-user', orders: [{ id: 'fake' }] }) : undefined,
    });
    const response = await route[method](request);
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'ORDERS_CACHE_REMOVED' });
    assert.equal(request.bodyUsed, false);
  });
}
