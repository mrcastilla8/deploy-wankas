import { NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/adminAuth';
import { readAdminRouteCache } from '@/lib/adminRouteCache';
import { createAdminClient } from '@/lib/supabase/adminClient';

const cacheControl = 'private, no-store';
const revenuePageSize = 500;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': cacheControl } });
}

async function loadTotalRevenue(supabase: ReturnType<typeof createAdminClient>) {
  let total = 0;
  let afterId: string | undefined;
  while (true) {
    let query = supabase.from('orders').select('id, total_price')
      .eq('status', 'completed').order('id', { ascending: true }).limit(revenuePageSize);
    if (afterId) query = query.gt('id', afterId);

    const { data, error } = await query;
    if (error || !data) throw new Error('Admin revenue query failed');
    // The server can cap a page below the requested limit.
    if (data.length === 0) return total;
    for (const order of data) total += order.total_price;
    afterId = data[data.length - 1].id;
  }
}

export async function GET(request: Request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', cacheControl);
    return auth.response;
  }
  if (auth.principal.role !== 'admin') return json({ error: 'FORBIDDEN' }, 403);

  try {
    const payload = await readAdminRouteCache('dashboard', auth.principal.role, async () => {
      const supabase = createAdminClient();
      const [orders, totalRevenue, products, locations, recent] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }),
        loadTotalRevenue(supabase),
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('locations').select('id', { count: 'exact', head: true }),
        supabase.from('orders')
          .select('id, total_price, status, profiles(name), locations(name_es)')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      if (
        orders.error || orders.count === null ||
        products.error || products.count === null ||
        locations.error || locations.count === null ||
        recent.error || !recent.data
      ) {
        throw new Error('Admin dashboard query failed');
      }

      return {
        stats: {
          totalOrders: orders.count,
          totalRevenue,
          activeProducts: products.count,
          activeLocations: locations.count,
        },
        recentOrders: recent.data,
      };
    });
    return json(payload);
  } catch {
    return json({ error: 'INTERNAL_SERVER_ERROR' }, 500);
  }
}
