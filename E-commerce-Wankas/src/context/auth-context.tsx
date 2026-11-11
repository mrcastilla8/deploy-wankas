'use client';

import type { User } from '@/types';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { clientCache } from '@/lib/clientCache';
import { AuthRequestGuard } from '@/lib/authRequestGuard';
import { toast } from '@/hooks/use-toast';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const PROFILE_FIELDS = 'id, name, email, phone_number, role';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestGuard = useRef(new AuthRequestGuard());
  const mounted = useRef(false);
  const lastSessionKey = useRef<string | null>(null);
  const receivedAuthEvent = useRef(false);

  const hydrate = useCallback(async (session: Session | null, event: AuthChangeEvent) => {
    if (!mounted.current) return;
    const authUser = session?.user;
    const sessionKey = authUser ? `${authUser.id}:${session.access_token}` : null;
    // INITIAL_SESSION and getSession can report the same token. Hydrate it once.
    if (event === 'INITIAL_SESSION' && sessionKey && sessionKey === lastSessionKey.current) return;
    if (sessionKey === lastSessionKey.current && event === 'INITIAL_SESSION') return;
    lastSessionKey.current = sessionKey;
    const requestGeneration = requestGuard.current.begin();
    clientCache.invalidateAll();

    if (!authUser) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    // Supabase callbacks must remain synchronous. The scheduled task starts after Auth
    // finishes dispatching the event, so profile reads cannot deadlock token refresh.
    queueMicrotask(async () => {
      try {
        let profile: { id: string; name: string | null; email: string | null; phone_number: string | null; role: string | null } | null = null;
        if (supabase) {
          const { data, error } = await supabase.from('profiles').select(PROFILE_FIELDS).eq('id', authUser.id).maybeSingle();
          if (error) console.error('No se pudo hidratar el perfil del usuario autenticado.');
          else profile = data;
        }
        if (!mounted.current || !requestGuard.current.isCurrent(requestGeneration)) return;
        setUser({
          id: authUser.id,
          email: profile?.email ?? authUser.email ?? null,
          name: profile?.name ?? (typeof authUser.user_metadata?.name === 'string' ? authUser.user_metadata.name : null),
          phone_number: profile?.phone_number ?? null,
          role: profile?.role ?? null,
        });
      } catch {
        // A profile read failure does not invalidate a valid Supabase Auth session.
        if (mounted.current && requestGuard.current.isCurrent(requestGeneration)) {
          setUser({
            id: authUser.id,
            email: authUser.email ?? null,
            name: typeof authUser.user_metadata?.name === 'string' ? authUser.user_metadata.name : null,
            phone_number: null,
            role: null,
          });
        }
      } finally {
        if (mounted.current && requestGuard.current.isCurrent(requestGeneration)) setIsLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    receivedAuthEvent.current = false;
    try { window.localStorage.removeItem('wankas-user'); } catch { /* Storage may be disabled. */ }
    if (!supabase) {
      setIsLoading(false);
      return () => { mounted.current = false; requestGuard.current.dispose(); };
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      receivedAuthEvent.current = true;
      // A duplicate initial notification is deduplicated against getSession below.
      setTimeout(() => { void hydrate(session, event); }, 0);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('No se pudo recuperar la sesión de Supabase.');
      // Do not let a late getSession overwrite an auth event already dispatched.
      if (mounted.current && !receivedAuthEvent.current) void hydrate(data.session, 'INITIAL_SESSION');
    }).catch(() => {
      if (mounted.current && !receivedAuthEvent.current) {
        requestGuard.current.invalidate();
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => {
      mounted.current = false;
      requestGuard.current.invalidate();
      lastSessionKey.current = null;
      subscription.unsubscribe();
    };
  }, [hydrate]);

  const logout = useCallback(async (): Promise<boolean> => {
    if (!supabase) {
      toast({ title: 'No se pudo cerrar sesión', description: 'El servicio de autenticación no está disponible.', variant: 'destructive' });
      return false;
    }
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('No se pudo cerrar la sesión de Supabase.');
        toast({ title: 'No se pudo cerrar sesión', description: 'Inténtalo de nuevo. Tu sesión sigue activa.', variant: 'destructive' });
        return false;
      }
      requestGuard.current.invalidate();
      lastSessionKey.current = null;
      setUser(null);
      setIsLoading(false);
      clientCache.invalidateAll();
      if (typeof window !== 'undefined') window.location.assign('/login');
      return true;
    } catch {
      console.error('No se pudo cerrar la sesión de Supabase.');
      toast({ title: 'No se pudo cerrar sesión', description: 'Inténtalo de nuevo. Tu sesión sigue activa.', variant: 'destructive' });
      return false;
    }
  }, []);

  return <AuthContext.Provider value={{ user, isLoading, logout }}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
