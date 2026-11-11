import { NextResponse } from 'next/server';

function ordersCacheRemoved() {
  return NextResponse.json({ error: 'ORDERS_CACHE_REMOVED' }, {
    status: 410,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export { ordersCacheRemoved as GET, ordersCacheRemoved as POST, ordersCacheRemoved as DELETE };
