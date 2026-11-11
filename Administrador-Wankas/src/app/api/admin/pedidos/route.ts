import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateAdmin, type AdminPrincipal } from '@/lib/adminAuth';
import { collectAdminRows } from '@/lib/adminPagination';
import { invalidateAdminRouteCache } from '@/lib/adminRouteCache';
import { createAdminClient } from '@/lib/supabase/adminClient';

export const dynamic = 'force-dynamic';

const orderFields = `
  id, user_id, location_id, order_date, pickup_date, status, total_price, notes,
  created_at, updated_at, profiles(name), locations(name_es), order_items(product_id, quantity)
`;

const orderStatus = z.enum(['completed', 'cancelled']);
const orderTransition = z.object({
  order_id: z.string().uuid().transform((id) => id.toLowerCase()),
  new_status: orderStatus,
}).strict();
const transitionResult = z.object({ order_id: z.string().uuid(), status: orderStatus });

const privateHeaders = { 'Cache-Control': 'private, no-store' };

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, {
    status,
    headers: status === 401 ? { ...privateHeaders, 'WWW-Authenticate': 'Bearer' } : privateHeaders,
  });
}

function rpcErrorResponse(
  { code, hint }: { code: string; hint: string | null },
  status: number,
  role: AdminPrincipal['role'],
) {
  if (code === '42501') return errorResponse('FORBIDDEN', 403);
  if (code === '28000' || status === 401) {
    return errorResponse('UNAUTHORIZED', 401);
  }
  if (code === '23514' && hint === 'TRANSICION_INVALIDA') {
    return errorResponse('ORDER_TRANSITION_CONFLICT', 409);
  }
  if (code === '22023' && hint === 'PEDIDO_NO_ENCONTRADO') {
    if (role === 'worker') return errorResponse('FORBIDDEN', 403);
    return errorResponse('ORDER_NOT_FOUND', 404);
  }
  if (code === '22P02' || (code === '22023' && hint === 'ESTADO_INVALIDO')) {
    return errorResponse('INVALID_REQUEST', 400);
  }
  return errorResponse('INTERNAL_SERVER_ERROR', 500);
}

async function authorizeOrders(request: Request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', privateHeaders['Cache-Control']);
    return auth;
  }
  const { role, locationId } = auth.principal;
  if (role === 'admin') return { ok: true as const, role, locationId: null };
  if (!locationId) {
    return { ok: false as const, response: errorResponse('FORBIDDEN', 403) };
  }
  return { ok: true as const, role, locationId };
}

export async function GET(request: Request) {
  const auth = await authorizeOrders(request);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createAdminClient();
    const data = await collectAdminRows((limit, afterId) => {
      let page = supabase.from('orders').select(orderFields).order('id').limit(limit);
      if (auth.locationId) page = page.eq('location_id', auth.locationId);
      if (afterId) page = page.gt('id', afterId);
      return page;
    });
    data.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)
      || right.created_at.localeCompare(left.created_at));

    return NextResponse.json(data, { headers: privateHeaders });
  } catch {
    return errorResponse('INTERNAL_SERVER_ERROR', 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await authorizeOrders(request);
  if (!auth.ok) return auth.response;

  const body = orderTransition.safeParse(await request.json().catch(() => null));
  if (!body.success) return errorResponse('INVALID_REQUEST', 400);

  const authorization = request.headers.get('authorization')!.replace(/^Bearer +/i, 'Bearer ');
  try {
    // REC-02 checks the order's location against the profile associated with auth.uid().
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: { headers: { Authorization: authorization } },
      },
    );
    const { data, error, status } = await supabase.rpc('transition_order_atomic', body.data);
    if (error) return rpcErrorResponse(error, status, auth.role);

    const result = transitionResult.safeParse(Array.isArray(data) && data.length === 1 ? data[0] : data);
    if (!result.success ||
      result.data.order_id !== body.data.order_id ||
      result.data.status !== body.data.new_status) {
      return errorResponse('INTERNAL_SERVER_ERROR', 500);
    }

    await invalidateAdminRouteCache(result.data.status === 'cancelled' ? 'catalogo' : 'dashboard');
    return NextResponse.json(result.data, { headers: privateHeaders });
  } catch {
    return errorResponse('INTERNAL_SERVER_ERROR', 500);
  }
}
