import test from 'node:test'
import assert from 'node:assert/strict'

import { parseNewProduct, parseProductChanges, type ProductFormValues } from './catalogoForm'

const VALID: ProductFormValues = {
  name_es: '  Papa amarilla  ',
  description_es: 'Por kilo',
  price: '4.50',
  stock: '20',
  category_id: '7f0c7a1e-2f4b-4d0a-9a3e-2b6f6f1d9c11',
}

test('crear: convierte el formulario al cuerpo que acepta la API', () => {
  assert.deepEqual(parseNewProduct(VALID), {
    ok: true,
    value: {
      name_es: 'Papa amarilla',
      description_es: 'Por kilo',
      price: 4.5,
      stock: 20,
      category_id: VALID.category_id,
    },
  })
})

test('editar: no incluye stock, porque el PATCH de la API lo rechaza', () => {
  const result = parseProductChanges({ ...VALID, stock: 'cualquier cosa' })
  assert.equal(result.ok, true)
  assert.ok(result.ok && !('stock' in result.value))
})

test('stock 0 es válido al crear', () => {
  assert.equal(parseNewProduct({ ...VALID, stock: '0' }).ok, true)
})

for (const [field, value, message] of [
  ['name_es', '   ', /nombre/],
  ['price', '', /precio/],
  ['price', '0', /precio/],
  ['price', '-3', /precio/],
  ['price', 'abc', /precio/],
  ['category_id', '', /categoría/],
] as const) {
  test(`rechaza ${field}=${JSON.stringify(value)} al crear y al editar`, () => {
    const form = { ...VALID, [field]: value }
    for (const result of [parseNewProduct(form), parseProductChanges(form)]) {
      assert.equal(result.ok, false)
      assert.match(!result.ok ? result.message : '', message)
    }
  })
}

for (const stock of ['', '-1', '2.5', '1e3', 'diez', '2147483648']) {
  test(`rechaza stock ${JSON.stringify(stock)} al crear`, () => {
    const result = parseNewProduct({ ...VALID, stock })
    assert.equal(result.ok, false)
    assert.match(!result.ok ? result.message : '', /stock/)
  })
}
