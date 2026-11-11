import { NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/adminAuth';
import { collectAdminRows } from '@/lib/adminPagination';
import { createAdminClient } from '@/lib/supabase/adminClient';

const cacheControl = 'private, no-store';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': cacheControl } });
}

export async function GET(request: Request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', cacheControl);
    return auth.response;
  }
  if (auth.principal.role !== 'admin') return json({ error: 'FORBIDDEN' }, 403);

  try {
    const supabase = createAdminClient();
    const [orders, products] = await Promise.all([
      collectAdminRows((limit, afterId) => {
        const page = supabase.from('orders')
          .select('id, order_date, status, total_price, locations(name_es), order_items(quantity, price_at_purchase, products(name_es, categories(name_es)))')
          .order('id', { ascending: true })
          .limit(limit);
        return afterId ? page.gt('id', afterId) : page;
      }),
      collectAdminRows((limit, afterId) => {
        const page = supabase.from('products').select('id, name_es, stock')
          .order('id', { ascending: true }).limit(limit);
        return afterId ? page.gt('id', afterId) : page;
      }),
    ]);
    return json({ orders, products });
  } catch {
    return json({ error: 'INTERNAL_SERVER_ERROR' }, 500);
  }
}
