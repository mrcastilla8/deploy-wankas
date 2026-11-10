import 'server-only';

import { NextResponse } from 'next/server';
import type { Database } from '@/types/database.types';
import { createAdminClient } from './supabase/adminClient';

export type AdminPrincipal = {
  userId: string;
  role: 'admin' | 'worker';
  locationId: string | null;
};

type AdminAuthResult =
  | { ok: true; principal: AdminPrincipal }
  | { ok: false; response: NextResponse };

// REC-01 owns the generated types for profiles.location_id.
type AdminProfile = Pick<Database['public']['Tables']['profiles']['Row'], 'role'> & {
  location_id: string | null;
};

function unauthorized(): AdminAuthResult {
  return {
    ok: false,
    response: NextResponse.json({ error: 'UNAUTHORIZED' }, {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    }),
  };
}

function internalError(): AdminAuthResult {
  return {
    ok: false,
    response: NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 }),
  };
}

export async function authenticateAdmin(request: Request): Promise<AdminAuthResult> {
  const token = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return unauthorized();

  try {
    const supabase = createAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError) {
      const status = authError.status;
      return status && status >= 400 && status < 500 && status !== 429
        ? unauthorized()
        : internalError();
    }
    if (!user) return unauthorized();

    const { data: profile, error: profileError } = await supabase
      .schema('public')
      .from('profiles')
      .select('role, location_id')
      .eq('id', user.id)
      .maybeSingle()
      .overrideTypes<AdminProfile, { merge: false }>();

    if (profileError) return internalError();
    if (!profile || (profile.role !== 'admin' && profile.role !== 'worker')) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }),
      };
    }

    return {
      ok: true,
      principal: { userId: user.id, role: profile.role, locationId: profile.location_id },
    };
  } catch {
    return internalError();
  }
}
