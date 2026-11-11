import test from 'node:test'
import assert from 'node:assert/strict'

import { adminCache } from './adminCache'
import {
  AdminApiError,
  NETWORK_ERROR_STATUS,
  adminMutation,
  adminRequest,
  describeAdminError,
  type AdminFetcher,
} from './adminApi'

type Call = { path: string; init?: RequestInit }

function fakeFetcher(response: Response | Error): { fetcher: AdminFetcher; calls: Call[] } {
  const calls: Call[] = []
  const fetcher: AdminFetcher = async (path, init) => {
    calls.push({ path, init })
    if (response instanceof Error) throw response
    return response
  }
  return { fetcher, calls }
}

async function rejection(promise: Promise<unknown>): Promise<AdminApiError> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof AdminApiError, 'debe lanzar AdminApiError')
    return error
  }
  assert.fail('la petición debía fallar')
}

test('respuesta 200: devuelve el cuerpo JSON tal cual', async () => {
  const payload = { products: [{ id: 'p1' }], categories: [] }
  const { fetcher, calls } = fakeFetcher(Response.json(payload))

  assert.deepEqual(await adminRequest('/api/admin/catalogo', undefined, fetcher), payload)
  assert.equal(calls[0].path, '/api/admin/catalogo')
})

test('error del servidor: lanza en lugar de devolver una lista vacía', async () => {
  const { fetcher } = fakeFetcher(Response.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 }))

  const error = await rejection(adminRequest('/api/admin/ubicaciones', undefined, fetcher))
  assert.equal(error.status, 500)
  assert.equal(error.code, 'INTERNAL_SERVER_ERROR')
})

for (const status of [401, 403]) {
  test(`${status}: invalida toda la caché del panel y marca error de autorización`, async () => {
    adminCache.set('catalogo', { products: ['de otra sesión'] })
    adminCache.set('ubicaciones', ['de otra sesión'])
    const { fetcher } = fakeFetcher(Response.json({ error: 'FORBIDDEN' }, { status }))

    const error = await rejection(adminRequest('/api/admin/catalogo', undefined, fetcher))
    assert.equal(error.isAuthError, true)
    assert.equal(adminCache.get('catalogo'), null)
    assert.equal(adminCache.get('ubicaciones'), null)
  })
}

test('otros errores no borran la caché ajena', async () => {
  adminCache.set('ubicaciones', ['sede-1'])
  const { fetcher } = fakeFetcher(Response.json({ error: 'INVALID_INPUT' }, { status: 400 }))

  const error = await rejection(adminRequest('/api/admin/catalogo', undefined, fetcher))
  assert.equal(error.isAuthError, false)
  assert.deepEqual(adminCache.get('ubicaciones'), ['sede-1'])
  adminCache.invalidateAll()
})

test('fallo de red: error con estado 0 y mensaje de conexión', async () => {
  const { fetcher } = fakeFetcher(new TypeError('Failed to fetch'))

  const error = await rejection(adminRequest('/api/admin/catalogo', undefined, fetcher))
  assert.equal(error.status, NETWORK_ERROR_STATUS)
  assert.match(describeAdminError(error), /conectar con el servidor/)
})

test('cuerpo de error no JSON: usa un código genérico', async () => {
  const { fetcher } = fakeFetcher(new Response('Bad gateway', { status: 502 }))

  const error = await rejection(adminRequest('/api/admin/catalogo', undefined, fetcher))
  assert.equal(error.code, 'UNKNOWN_ERROR')
  assert.match(describeAdminError(error), /servidor no pudo completar/)
})

test('respuesta 200 con JSON inválido: no se acepta como datos', async () => {
  const { fetcher } = fakeFetcher(new Response('<html>', { status: 200 }))

  const error = await rejection(adminRequest('/api/admin/catalogo', undefined, fetcher))
  assert.equal(error.code, 'INVALID_RESPONSE')
})

test('adminMutation: envía método, JSON y cabecera de contenido', async () => {
  const { fetcher, calls } = fakeFetcher(Response.json({ id: 'p1' }, { status: 201 }))

  await adminMutation('/api/admin/catalogo', 'POST', { name_es: 'Papa' }, fetcher)
  const init = calls[0].init!
  assert.equal(init.method, 'POST')
  assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json')
  assert.deepEqual(JSON.parse(String(init.body)), { name_es: 'Papa' })
})

test('mensajes por código: eliminación bloqueada, conflicto y estados HTTP', () => {
  const cases: Array<[number, string, RegExp]> = [
    [409, 'DELETE_BLOCKED', /historial de pedidos/],
    [409, 'INTEGRITY_CONFLICT', /conflicto con datos existentes/],
    [400, 'INVALID_INPUT', /no son válidos/],
    [401, 'UNAUTHORIZED', /sesión expiró/],
    [403, 'FORBIDDEN', /No tienes permisos/],
    [404, 'NOT_FOUND', /ya no existe/],
    [500, 'INTERNAL_SERVER_ERROR', /servidor no pudo completar/],
  ]
  for (const [status, code, expected] of cases) {
    assert.match(describeAdminError(new AdminApiError(status, code)), expected, `${status} ${code}`)
  }
  assert.match(describeAdminError(new Error('otro')), /error inesperado/)
})
