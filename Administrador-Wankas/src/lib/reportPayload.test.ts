import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InvalidReportPayloadError, parseReportPayload } from './reportPayload'
import { adminRequest } from './adminApi'

test('acepta colecciones vacías confirmadas por la API', () => {
  assert.deepEqual(parseReportPayload({ orders: [], products: [] }), { orders: [], products: [] })
})

test('valida los datos históricos y relaciones usados por el informe', () => {
  const payload = {
    orders: [{
      id: 'order-1', order_date: '2026-01-01T00:00:00Z', status: 'completed', total_price: 12,
      locations: { name_es: 'Huancayo' },
      order_items: [{ quantity: 2, price_at_purchase: 6, products: { name_es: 'Papa', categories: { name_es: 'Tubérculos' } } }],
    }],
    products: [{ id: 'product-1', name_es: 'Papa', stock: 9 }],
  }
  assert.deepEqual(parseReportPayload(payload), payload)
})

test('rechaza JSON 200 semánticamente incompleto', () => {
  assert.throws(
    () => parseReportPayload({ orders: [{ id: 'order-1' }], products: [] }),
    InvalidReportPayloadError,
  )
  assert.throws(() => parseReportPayload({ orders: [], products: [{ id: 'product-1', name_es: 'Papa' }] }), InvalidReportPayloadError)
})

test('un HTTP 200 incompleto no puede convertirse en un informe cargado', async () => {
  const body = await adminRequest<unknown>('/api/admin/informes', undefined, async () =>
    Response.json({ orders: [], products: [{ id: 'product-1', name_es: 'Papa' }] })
  )
  assert.throws(() => parseReportPayload(body), InvalidReportPayloadError)
})
