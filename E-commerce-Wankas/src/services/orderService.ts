import { supabase } from '@/lib/supabaseClient';
import type { Order, OrderItem, CartItem } from '@/types';
import { clientCache } from '@/lib/clientCache';

export interface EnrichedOrderItem extends OrderItem {
  productName?: string;
  productImageUrl?: string;
}

export interface EnrichedOrder extends Order {
  items: EnrichedOrderItem[];
  location_name?: string;
  location_address?: string;
}

/**
 * Contrato de entrada de place_order_atomic.
 * El navegador solo envía producto y cantidad: nunca precio, total ni user_id.
 */
export interface PlaceOrderItemInput {
  product_id: string;
  quantity: number;
}

export interface PlaceOrderResult {
  order_id: string;
  total_price: number;
  status: string;
}

export interface TransitionOrderResult {
  order_id: string;
  status: string;
}

interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

const DB_UNAVAILABLE = 'El servicio de base de datos no está disponible.';

function requireClient() {
  if (!supabase) {
    throw new Error(DB_UNAVAILABLE);
  }
  return supabase;
}

/**
 * Normaliza y valida el carrito antes de enviarlo a PostgreSQL.
 * La validación definitiva (stock, precios, permisos) vive en la función SQL.
 */
export function normalizeOrderItems(items: PlaceOrderItemInput[]): PlaceOrderItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('El carrito está vacío.');
  }

  const aggregated = new Map<string, number>();

  for (const item of items) {
    if (!item || typeof item.product_id !== 'string' || item.product_id.trim() === '') {
      throw new Error('El carrito contiene un producto inválido.');
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('Las cantidades deben ser números enteros mayores que cero.');
    }

    aggregated.set(item.product_id, (aggregated.get(item.product_id) ?? 0) + quantity);
  }

  return Array.from(aggregated.entries()).map(([product_id, quantity]) => ({
    product_id,
    quantity,
  }));
}

/**
 * Traduce los SQLSTATE/hints de PostgreSQL a mensajes de usuario.
 * Mapa acordado con REC-03:
 *   28000 -> 401, 42501 -> 403, 23514 -> 409, 22023/22P02 -> 400.
 */
export function mapRpcError(error: RpcErrorLike | null | undefined): Error {
  if (!error) {
    return new Error('No se pudo completar la operación.');
  }

  const hint = error.hint ?? '';

  if (hint === 'NO_AUTENTICADO' || error.code === '28000') {
    return new Error('Debes iniciar sesión para continuar.');
  }

  if (hint === 'SIN_PERMISO' || error.code === '42501') {
    return new Error('No tienes permiso para realizar esta operación.');
  }

  if (hint === 'STOCK_INSUFICIENTE') {
    return new Error(
      error.message?.trim() ||
        'No hay stock suficiente para uno o más productos del carrito.'
    );
  }

  if (hint === 'TRANSICION_INVALIDA' || error.code === '23514') {
    return new Error(
      error.message?.trim() || 'El pedido ya no permite la acción solicitada.'
    );
  }

  if (hint === 'ITEM_INVALIDO' || hint === 'PRODUCTO_INVALIDO' || error.code === '22023') {
    return new Error(
      error.message?.trim() || 'El pedido contiene datos inválidos. Revisa el carrito.'
    );
  }

  if (hint === 'SEDE_INVALIDA') {
    return new Error('La sede de recojo seleccionada no es válida.');
  }

  if (hint === 'FECHA_INVALIDA') {
    return new Error('La fecha de recojo debe ser futura.');
  }

  if (hint === 'NOTAS_INVALIDAS') {
    return new Error('Las notas del pedido son demasiado largas.');
  }

  if (hint === 'PEDIDO_NO_ENCONTRADO' || error.code === '22P02') {
    return new Error('El pedido no existe o ya no está disponible.');
  }

  console.error('Error RPC de pedidos:', error);
  return new Error(error.message?.trim() || 'No se pudo completar la operación.');
}

async function currentUserId(): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.auth.getUser();

  if (error || !data?.user) {
    throw new Error('Debes iniciar sesión para continuar.');
  }

  return data.user.id;
}

function invalidateOrdersCache(userId: string) {
  try {
    clientCache.invalidate(`orders_${userId}`);
  } catch (error) {
    console.error('No se pudo invalidar la caché local de pedidos:', error);
  }
}

/**
 * Crea el pedido y reserva el stock en una sola transacción PostgreSQL.
 * El total y el comprador los determina la base de datos.
 */
export async function placeOrderAtomic(input: {
  locationId: string;
  pickupDate: string;
  notes?: string | null;
  items: PlaceOrderItemInput[];
}): Promise<PlaceOrderResult> {
  const client = requireClient();

  if (!input.locationId) {
    throw new Error('Debes seleccionar una sede de recojo.');
  }

  if (!input.pickupDate || Number.isNaN(new Date(input.pickupDate).getTime())) {
    throw new Error('Debes seleccionar una fecha de recojo válida.');
  }

  if (new Date(input.pickupDate).getTime() <= Date.now()) {
    throw new Error('La fecha de recojo debe ser futura.');
  }

  const items = normalizeOrderItems(input.items);
  const userId = await currentUserId();

  const { data, error } = await client.rpc('place_order_atomic', {
    location_id: input.locationId,
    pickup_date: input.pickupDate,
    notes: input.notes?.trim() ? input.notes.trim() : null,
    items,
  });

  if (error) {
    throw mapRpcError(error);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.order_id) {
    throw new Error('No se pudo confirmar el pedido.');
  }

  invalidateOrdersCache(userId);

  return {
    order_id: row.order_id,
    total_price: Number(row.total_price),
    status: row.status,
  };
}

/**
 * Compatibilidad con el flujo anterior. Ya no acepta precios ni user_id:
 * esos valores los determina PostgreSQL.
 */
export async function placeOrderWithStockUpdate(
  orderData: Pick<Order, 'location_id' | 'pickup_date' | 'notes'>,
  items: CartItem[]
): Promise<PlaceOrderResult> {
  return placeOrderAtomic({
    locationId: orderData.location_id,
    pickupDate: orderData.pickup_date,
    notes: orderData.notes ?? null,
    items: items.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
    })),
  });
}

/**
 * Historial del usuario autenticado. El parámetro se conserva por
 * compatibilidad, pero la autoridad es la sesión y RLS.
 */
export async function getUserOrders(_userId?: string): Promise<EnrichedOrder[]> {
  const client = requireClient();
  const userId = await currentUserId();

  const { data: ordersData, error: ordersError } = await client
    .from('orders')
    .select(`
      id, user_id, location_id, order_date, pickup_date, status, total_price, notes, created_at, updated_at,
      locations (name_es, address)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (ordersError) {
    console.error('Error fetching orders:', ordersError);
    throw new Error('No se pudieron cargar tus pedidos.');
  }

  if (!ordersData) return [];

  const enrichedOrders: EnrichedOrder[] = [];

  for (const order of ordersData) {
    const { data: orderItemsData, error: orderItemsError } = await client
      .from('order_items')
      .select(`*, products (name_es, thumbnail_url, image_urls)`)
      .eq('order_id', order.id);

    if (orderItemsError) {
      console.error(`Error fetching items for order ${order.id}:`, orderItemsError);
    }

    const items: EnrichedOrderItem[] = (orderItemsData ?? []).map(item => {
      const product = item.products as any;
      let imageUrl = 'https://placehold.co/80x80.png';
      if (product?.thumbnail_url) imageUrl = product.thumbnail_url;
      else if (product?.image_urls?.[0]) imageUrl = product.image_urls[0];

      return {
        ...item,
        productName: product?.name_es || 'Nombre no disponible',
        productImageUrl: imageUrl,
      };
    });

    const locationDetails = order.locations as any;
    enrichedOrders.push({
      ...order,
      location_name: locationDetails?.name_es || 'Ubicación desconocida',
      location_address: locationDetails?.address || 'Dirección no disponible',
      items,
    });
  }

  return enrichedOrders;
}

/**
 * Cancela un pedido propio pendiente mediante transition_order_atomic.
 * El userId se conserva por compatibilidad y no se usa como autoridad.
 */
export async function cancelOrder(orderId: string, _userId?: string): Promise<boolean> {
  const client = requireClient();

  if (!orderId) {
    throw new Error('El pedido es obligatorio.');
  }

  const userId = await currentUserId();

  const { data, error } = await client.rpc('transition_order_atomic', {
    order_id: orderId,
    new_status: 'cancelled',
  });

  if (error) {
    throw mapRpcError(error);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.order_id) {
    throw new Error('No se pudo cancelar el pedido.');
  }

  invalidateOrdersCache(userId);
  return true;
}
