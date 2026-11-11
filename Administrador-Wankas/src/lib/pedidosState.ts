/**
 * Estado puro de la lista de pedidos del panel administrativo.
 *
 * Los pedidos se atan a la identidad de la sesión que los produjo. El render
 * solo muestra `orders` cuando `identity === sessionIdentity`; así un cambio de
 * sesión oculta el listado en el mismo render, sin esperar a un `useEffect`.
 *
 * `requestSeq` es monotónico entre sesiones: una respuesta HTTP retrasada de
 * una sesión anterior se descarta aunque llegue después del cambio.
 */

export type SessionIdentity = string | null

export interface OrdersState<T> {
  /** Identidad que produjo `orders`; `null` si no hay datos válidos. */
  identity: SessionIdentity
  orders: T[]
  loading: boolean
  /** Último identificador de solicitud aceptado. */
  requestSeq: number
  /** La última solicitud terminó en 401/403. */
  denied: boolean
}

export type OrdersAction<T> =
  | { type: 'request-started'; requestId: number }
  | { type: 'request-succeeded'; requestId: number; identity: string; orders: T[] }
  | { type: 'request-failed'; requestId: number; identity: string }
  | { type: 'identity-changed'; requestId: number }
  | { type: 'auth-error'; requestId: number }

export function initialOrdersState<T>(): OrdersState<T> {
  return {
    identity: null,
    orders: [],
    loading: false,
    requestSeq: 0,
    denied: false,
  }
}

function nextSeq(current: number, requestId: number): number {
  return requestId > current ? requestId : current
}

export function ordersReducer<T>(
  state: OrdersState<T>,
  action: OrdersAction<T>
): OrdersState<T> {
  switch (action.type) {
    case 'request-started':
      return {
        ...state,
        loading: true,
        denied: false,
        requestSeq: nextSeq(state.requestSeq, action.requestId),
      }

    case 'request-succeeded':
      if (action.requestId !== state.requestSeq) return state
      return {
        ...state,
        identity: action.identity,
        orders: action.orders,
        loading: false,
        denied: false,
      }

    case 'request-failed':
      if (action.requestId !== state.requestSeq) return state
      return {
        ...state,
        identity: action.identity,
        orders: [],
        loading: false,
        denied: false,
      }

    case 'identity-changed':
      return {
        identity: null,
        orders: [],
        loading: false,
        denied: false,
        requestSeq: nextSeq(state.requestSeq, action.requestId),
      }

    case 'auth-error':
      return {
        identity: null,
        orders: [],
        loading: false,
        denied: true,
        requestSeq: nextSeq(state.requestSeq, action.requestId),
      }

    default:
      return state
  }
}

/**
 * Pedidos que pueden pintarse para la sesión actual. Si la identidad no
 * coincide, devuelve una lista vacía: nunca se muestran datos de otra sesión.
 */
export function selectVisibleOrders<T>(
  state: OrdersState<T>,
  sessionIdentity: SessionIdentity
): T[] {
  if (sessionIdentity === null || state.identity !== sessionIdentity) {
    return []
  }
  return state.orders
}

/**
 * Indica si corresponde mostrar el loader: hay una carga en curso o todavía no
 * existen pedidos de la identidad actual. Tras un 401/403 no se muestra el
 * loader, porque no habrá respuesta hasta que cambie la sesión.
 */
export function selectIsOrdersLoading<T>(
  state: OrdersState<T>,
  sessionIdentity: SessionIdentity
): boolean {
  if (state.denied) return false
  if (sessionIdentity === null) return false
  return state.loading || state.identity !== sessionIdentity
}
