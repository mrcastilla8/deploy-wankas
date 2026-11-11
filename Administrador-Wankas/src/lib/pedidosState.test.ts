import test from 'node:test'
import assert from 'node:assert/strict'

import { adminCache } from './adminCache'
import {
  initialOrdersState,
  isCurrentResponse,
  ordersReducer,
  selectIsOrdersLoading,
  selectVisibleOrders,
  type OrdersState,
} from './pedidosState'

const ADMIN = 'admin-1:admin:all'
const WORKER = 'worker-1:worker:sede-1'

function loadedWith(identity: string, orders: string[]): OrdersState<string> {
  let state = initialOrdersState<string>()
  state = ordersReducer(state, { type: 'request-started', requestId: 1 })
  state = ordersReducer(state, {
    type: 'request-succeeded',
    requestId: 1,
    identity,
    orders,
  })
  return state
}

test('admin -> worker: el render no muestra pedidos de la sesion anterior', () => {
  const state = loadedWith(ADMIN, ['pedido-admin'])

  assert.deepEqual(selectVisibleOrders(state, ADMIN), ['pedido-admin'])

  // Render con la nueva identidad, antes de que corra el useEffect de limpieza.
  assert.deepEqual(selectVisibleOrders(state, WORKER), [])
  assert.equal(selectIsOrdersLoading(state, WORKER), true)

  // El efecto de cambio de identidad limpia el estado.
  const cleared = ordersReducer(state, {
    type: 'identity-changed',
    requestId: 2,
  })
  assert.equal(cleared.identity, null)
  assert.deepEqual(cleared.orders, [])
})

test('respuesta HTTP retrasada no actualiza la pantalla de la sesion nueva', () => {
  let state = initialOrdersState<string>()
  state = ordersReducer(state, { type: 'request-started', requestId: 1 })
  state = ordersReducer(state, { type: 'identity-changed', requestId: 2 })
  state = ordersReducer(state, { type: 'request-started', requestId: 3 })

  // Llega tarde la respuesta de la sesion anterior (admin).
  state = ordersReducer(state, {
    type: 'request-succeeded',
    requestId: 1,
    identity: ADMIN,
    orders: ['viejo'],
  })

  assert.equal(state.identity, null)
  assert.deepEqual(state.orders, [])
  assert.deepEqual(selectVisibleOrders(state, WORKER), [])

  // Llega la respuesta correcta de la sesion nueva.
  state = ordersReducer(state, {
    type: 'request-succeeded',
    requestId: 3,
    identity: WORKER,
    orders: ['nuevo'],
  })

  assert.deepEqual(selectVisibleOrders(state, WORKER), ['nuevo'])
  assert.equal(selectIsOrdersLoading(state, WORKER), false)
})

test('respuesta retrasada sin solicitud nueva tampoco revive pedidos viejos', () => {
  let state = loadedWith(ADMIN, ['pedido-admin'])
  state = ordersReducer(state, { type: 'identity-changed', requestId: 2 })
  state = ordersReducer(state, {
    type: 'request-succeeded',
    requestId: 1,
    identity: ADMIN,
    orders: ['pedido-admin'],
  })

  assert.equal(state.identity, null)
  assert.deepEqual(state.orders, [])
  assert.deepEqual(selectVisibleOrders(state, ADMIN), [])
})

test('401/403 limpia pedidos y cache', () => {
  let state = loadedWith(ADMIN, ['pedido-admin'])
  adminCache.set('pedidos', ['pedido-admin'])
  adminCache.set('ubicaciones', [{ id: 'sede-1' }])

  state = ordersReducer(state, { type: 'auth-error', requestId: 2 })
  adminCache.invalidateAll()

  assert.equal(state.identity, null)
  assert.deepEqual(state.orders, [])
  assert.deepEqual(selectVisibleOrders(state, ADMIN), [])
  assert.equal(state.loading, false)
  // No queda un loader infinito: la sesion debe cambiar para volver a cargar.
  assert.equal(selectIsOrdersLoading(state, ADMIN), false)
  assert.equal(adminCache.get('pedidos'), null)
  assert.equal(adminCache.get('ubicaciones'), null)
})

test('tras un 401/403 una solicitud nueva vuelve a mostrar el loader', () => {
  let state = loadedWith(ADMIN, ['pedido-admin'])
  state = ordersReducer(state, { type: 'auth-error', requestId: 2 })
  assert.equal(selectIsOrdersLoading(state, WORKER), false)

  state = ordersReducer(state, { type: 'request-started', requestId: 3 })
  assert.equal(selectIsOrdersLoading(state, WORKER), true)
  assert.deepEqual(selectVisibleOrders(state, WORKER), [])
})

test('un fallo de red deja la lista vacia y no muestra datos viejos', () => {
  let state = loadedWith(ADMIN, ['pedido-admin'])
  state = ordersReducer(state, { type: 'identity-changed', requestId: 2 })
  state = ordersReducer(state, { type: 'request-started', requestId: 3 })
  state = ordersReducer(state, {
    type: 'request-failed',
    requestId: 3,
    identity: WORKER,
  })

  assert.deepEqual(selectVisibleOrders(state, WORKER), [])
  assert.equal(selectIsOrdersLoading(state, WORKER), false)
})

test('una respuesta valida de la identidad actual si se muestra', () => {
  let state = initialOrdersState<string>()
  state = ordersReducer(state, { type: 'request-started', requestId: 5 })
  state = ordersReducer(state, {
    type: 'request-succeeded',
    requestId: 5,
    identity: WORKER,
    orders: ['pedido-worker'],
  })

  assert.deepEqual(selectVisibleOrders(state, WORKER), ['pedido-worker'])
  assert.equal(selectIsOrdersLoading(state, WORKER), false)
})

test('admin -> worker con PATCH pendiente: la respuesta vieja se descarta', () => {
  let state = loadedWith(ADMIN, ['pedido-admin'])

  // El admin lanza un PATCH y queda en curso.
  state = ordersReducer(state, {
    type: 'patch-started',
    requestId: 2,
    orderId: 'pedido-admin',
  })
  assert.equal(state.updatingOrderId, 'pedido-admin')

  // Cambia la sesión mientras el PATCH sigue en vuelo.
  state = ordersReducer(state, { type: 'identity-changed', requestId: 3 })
  assert.equal(state.updatingOrderId, null)
  assert.deepEqual(selectVisibleOrders(state, WORKER), [])

  // Llega tarde el PATCH del admin: no limpia ni revive nada de la sesión nueva.
  const settled = ordersReducer(state, { type: 'patch-finished', requestId: 2 })
  assert.equal(settled, state)
  assert.equal(settled.updatingOrderId, null)
  assert.deepEqual(selectVisibleOrders(settled, WORKER), [])
})

test('un PATCH viejo no limpia el updatingOrderId de uno nuevo', () => {
  let state = initialOrdersState<string>()
  state = ordersReducer(state, {
    type: 'patch-started',
    requestId: 1,
    orderId: 'pedido-admin',
  })
  state = ordersReducer(state, { type: 'identity-changed', requestId: 2 })
  state = ordersReducer(state, {
    type: 'patch-started',
    requestId: 3,
    orderId: 'pedido-worker',
  })

  state = ordersReducer(state, { type: 'patch-finished', requestId: 1 })
  assert.equal(state.updatingOrderId, 'pedido-worker')

  state = ordersReducer(state, { type: 'patch-finished', requestId: 3 })
  assert.equal(state.updatingOrderId, null)
})

test('un 401/403 durante el PATCH limpia el updatingOrderId', () => {
  let state = loadedWith(ADMIN, ['pedido-admin'])
  state = ordersReducer(state, {
    type: 'patch-started',
    requestId: 2,
    orderId: 'pedido-admin',
  })

  state = ordersReducer(state, { type: 'auth-error', requestId: 3 })
  assert.equal(state.updatingOrderId, null)
  assert.deepEqual(state.orders, [])
  assert.equal(state.denied, true)
})

test('isCurrentResponse descarta respuestas de otra sesion o de otra solicitud', () => {
  assert.equal(isCurrentResponse(5, 5, WORKER, WORKER), true)
  // Llegó una solicitud más nueva.
  assert.equal(isCurrentResponse(5, 6, WORKER, WORKER), false)
  // La sesión cambió mientras la solicitud estaba en vuelo.
  assert.equal(isCurrentResponse(5, 5, ADMIN, WORKER), false)
  // Sin identidad no hay respuesta válida.
  assert.equal(isCurrentResponse(5, 5, WORKER, null), false)
})
