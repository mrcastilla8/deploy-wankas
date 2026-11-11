'use client';

import { createClient } from './supabase/client';

export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: { session }, error } = await createClient().auth.getSession();
  if (error || !session?.access_token) {
    return Response.json({ error: 'NO_ADMIN_SESSION' }, { status: 401 });
  }

  const target = new URL(path, window.location.href);
  if (target.origin !== window.location.origin || target.protocol !== window.location.protocol) {
    throw new TypeError('adminFetch only accepts same-origin URLs');
  }

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);

  return fetch(target, { ...init, headers });
}
