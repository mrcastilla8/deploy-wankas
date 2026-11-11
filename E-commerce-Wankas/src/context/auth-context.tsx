'use client';

import type { User } from '@/types';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { clientCache } from '@/lib/clientCache';
import { AuthSessionController, type AuthClient } from '@/lib/authSessionController';
import { toast } from '@/hooks/use-toast';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const controller = useRef<AuthSessionController | null>(null);

  useEffect(() => {
    try { window.localStorage.removeItem('wankas-user'); } catch { /* Storage may be disabled. */ }
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    const instance = new AuthSessionController(
      // Use only the Auth and profile methods required by this controller; PostgREST's
      // generated builder type is too deeply recursive for this structural boundary.
      supabase as unknown as AuthClient,
      state => { setUser(state.user); setIsLoading(state.isLoading); },
      () => clientCache.invalidateAll(),
      () => toast({ title: 'No se pudo cerrar sesión', description: 'Inténtalo de nuevo. Tu sesión sigue activa.', variant: 'destructive' }),
      () => { window.location.assign('/login'); },
    );
    controller.current = instance;
    const dispose = instance.start();
    return () => {
      dispose();
      if (controller.current === instance) controller.current = null;
    };
  }, []);

  const logout = useCallback(async (): Promise<boolean> => {
    if (!controller.current) {
      toast({ title: 'No se pudo cerrar sesión', description: 'El servicio de autenticación no está disponible.', variant: 'destructive' });
      return false;
    }
    return controller.current.logout();
  }, []);

  return <AuthContext.Provider value={{ user, isLoading, logout }}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
