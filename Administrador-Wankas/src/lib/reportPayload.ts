export type ReportOrder = {
  id: string
  order_date: string
  status: string
  total_price: number
  locations: { name_es: string } | null
  order_items: Array<{
    quantity: number
    price_at_purchase: number
    products: { name_es: string; categories: { name_es: string } | null } | null
  }>
}

export type ReportProduct = { id: string; name_es: string; stock: number }
export type ReportPayload = { orders: ReportOrder[]; products: ReportProduct[] }

export class InvalidReportPayloadError extends Error {
  constructor() {
    super('La respuesta de informes tiene una estructura inválida.')
    this.name = 'InvalidReportPayloadError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string { return typeof value === 'string' }
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isName(value: unknown): value is { name_es: string } {
  return isRecord(value) && isString(value.name_es)
}

function isOrderItem(value: unknown): value is ReportOrder['order_items'][number] {
  if (!isRecord(value) || !isFiniteNumber(value.quantity) || !isFiniteNumber(value.price_at_purchase)) return false
  if (value.products === null) return true
  if (!isRecord(value.products) || !isString(value.products.name_es)) return false
  return value.products.categories === null || isName(value.products.categories)
}

function isOrder(value: unknown): value is ReportOrder {
  return isRecord(value)
    && isString(value.id)
    && isString(value.order_date)
    && isString(value.status)
    && isFiniteNumber(value.total_price)
    && (value.locations === null || isName(value.locations))
    && Array.isArray(value.order_items)
    && value.order_items.every(isOrderItem)
}

function isProduct(value: unknown): value is ReportProduct {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name_es)
    && isFiniteNumber(value.stock)
}

/** Verifica los campos mínimos que consume el informe antes de publicar datos. */
export function parseReportPayload(value: unknown): ReportPayload {
  if (!isRecord(value)
    || !Array.isArray(value.orders)
    || !value.orders.every(isOrder)
    || !Array.isArray(value.products)
    || !value.products.every(isProduct)) {
    throw new InvalidReportPayloadError()
  }

  return { orders: value.orders, products: value.products }
}
