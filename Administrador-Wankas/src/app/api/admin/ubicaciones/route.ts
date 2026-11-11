import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateAdmin } from '@/lib/adminAuth';
import { invalidateAdminRouteCache, readAdminRouteCache } from '@/lib/adminRouteCache';
import { createAdminClient } from '@/lib/supabase/adminClient';

const cacheControl = 'private, no-store';
const idSchema = z.object({ id: z.string().uuid() });
const locationSchema = z.object({
  name_es: z.string().trim().min(1),
  address: z.string().trim().min(1),
});
const mutationSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('POST'), body: locationSchema }),
  z.object({ method: z.literal('PATCH'), body: locationSchema.merge(idSchema) }),
  z.object({ method: z.literal('DELETE'), body: idSchema }),
]);

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': cacheControl } });
}

export async function GET(request: Request) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', cacheControl);
    return auth.response;
  }

  try {
    const payload = await readAdminRouteCache('ubicaciones', auth.principal.role, async () => {
      const { data, error } = await createAdminClient().from('locations')
        .select('id, name_es, address')
        .order('name_es', { ascending: true });
      if (error || !data) throw new Error('Admin locations query failed');
      return data;
    });
    return json(payload);
  } catch {
    return json({ error: 'INTERNAL_SERVER_ERROR' }, 500);
  }
}

async function mutate(request: Request, method: z.infer<typeof mutationSchema>['method']) {
  const auth = await authenticateAdmin(request);
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', cacheControl);
    return auth.response;
  }
  if (auth.principal.role !== 'admin') return json({ error: 'FORBIDDEN' }, 403);

  const input = mutationSchema.safeParse({ method, body: await request.json().catch(() => undefined) });
  if (!input.success) return json({ error: 'INVALID_INPUT' }, 400);
  // REC-01 must protect the location of pending orders before enabling deletes.
  if (input.data.method === 'DELETE') return json({ error: 'DELETE_BLOCKED' }, 409);

  try {
    const locations = createAdminClient().from('locations');
    let query;
    if (input.data.method === 'POST') {
      query = locations.insert(input.data.body);
    } else {
      const { id, ...changes } = input.data.body;
      query = locations.update(changes).eq('id', id);
    }

    const { data, error } = await query.select('id');
    if (error?.code?.startsWith('23')) return json({ error: 'INTEGRITY_CONFLICT' }, 409);
    if (error || !data) return json({ error: 'INTERNAL_SERVER_ERROR' }, 500);
    if (data.length === 0 && method !== 'POST') return json({ error: 'NOT_FOUND' }, 404);
    if (data.length !== 1) return json({ error: 'INTERNAL_SERVER_ERROR' }, 500);

    await invalidateAdminRouteCache('ubicaciones');
    return json(data[0], method === 'POST' ? 201 : 200);
  } catch {
    return json({ error: 'INTERNAL_SERVER_ERROR' }, 500);
  }
}

export async function POST(request: Request) {
  return mutate(request, 'POST');
}

export async function PATCH(request: Request) {
  return mutate(request, 'PATCH');
}

export async function DELETE(request: Request) {
  return mutate(request, 'DELETE');
}
