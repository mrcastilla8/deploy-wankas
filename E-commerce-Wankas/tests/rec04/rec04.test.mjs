import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { safeInternalRedirect } from '../../src/lib/safeRedirect.ts';
import { AuthRequestGuard } from '../../src/lib/authRequestGuard.ts';
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

test('el catálogo conserva IDs y productos con nombres duplicados, y acepta lista vacía', () => {
  const rows = [
    { id: 'pg-1', name_es: 'Papa', description_es: null, price: 2.5, stock: 3, categories: { name_es: 'Tubérculos' } },
    { id: 'pg-2', name_es: 'Papa', description_es: 'Otra variedad', price: 3, stock: 4, categories: { name_es: 'Tubérculos' } },
  ];
  const products = mapProductRows(rows);
  assert.deepEqual(products.map(product => product.id), ['pg-1', 'pg-2']);
  assert.deepEqual(mapProductRows([]), []);
  assert.throws(() => mapProductRows([{ ...rows[0], price: null }]), ProductCatalogError);
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
  const root = new URL('../../src/', import.meta.url);
  const { stdout } = await import('node:child_process').then(({ execFileSync }) => ({ stdout: execFileSync('rg', ['-n', 'registerUser|loginUser|actions/auth', root.pathname], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } )).catch(() => ({ stdout: '' }));
  assert.equal(stdout, '');
});

test('el registro solo envía nombre y los logs Genkit no imprimen entradas', async () => {
  const registration = await readFile(new URL('../../src/components/auth/register-form.tsx', import.meta.url), 'utf8');
  assert.match(registration, /data:\s*\{\s*name\s*\}/);
  assert.doesNotMatch(registration, /role\s*:/);
  const authContext = await readFile(new URL('../../src/context/auth-context.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(authContext, /user_metadata\??\.role/);
  assert.match(authContext, /role:\s*profile\?\.role\s*\?\?\s*null/);
  assert.doesNotMatch(authContext, /localStorage\.setItem\(['"]wankas-user/);
  for (const file of ['identify-food-items.ts', 'suggest-recipes.ts', 'suggest-missing-ingredients.ts']) {
    const source = await readFile(new URL(`../../src/ai/flows/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*(?:input|promptParts|photoDataUris|availableIngredients)/i, file);
  }
});
