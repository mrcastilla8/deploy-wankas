"use client";

import type { UserProfile } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { adminCache } from '@/lib/adminCache';
import { useRouter } from 'next/navigation';
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

interface AuthError {
  message: string;
}

interface AuthContextType {
  user: UserProfile | null;
  login: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  logout: () => void;
  loading: boolean;
  updateUser: (updatedData: DisplayProfileFields) => void;
}

// Solo datos de presentación. El rol y la sede (`role`, `location_id`) vienen de
// `profiles` y nunca se modifican desde el cliente.
type DisplayProfileFields = Partial<Pick<UserProfile, 'name' | 'phone_number' | 'locationName'>>;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USER_STORAGE_KEY = 'wankas_user';
const PROFILE_FIELDS = 'id, name, email, phone_number, role, location_id, created_at, updated_at';

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let requestId = 0;
    let observedAuthUserId: string | null = null;
    let active = true;
    const clearUser = () => {
      adminCache.setIdentity(null);
      setUser(null);
      localStorage.removeItem(USER_STORAGE_KEY);
    };
    const hydrate = async (authUserId: string | null, showLoading: boolean) => {
      const currentRequest = ++requestId;
      if (observedAuthUserId !== authUserId) {
        const identityChanged = observedAuthUserId !== null || authUserId === null;
        observedAuthUserId = authUserId;
        // Al cambiar el sujeto autenticado se ocultan inmediatamente los datos previos.
        if (identityChanged) {
          adminCache.setIdentity(null);
          setUser(null);
        }
      }
      if (showLoading) setLoading(true);
      if (!authUserId) {
        clearUser();
        if (active && currentRequest === requestId) setLoading(false);
        return;
      }
      try {
        const { data: profile } = await supabase.from('profiles').select(PROFILE_FIELDS)
          .eq('id', authUserId).single();
        if (!active || currentRequest !== requestId) return;
        if (profile && (profile.role === 'admin' || profile.role === 'worker')) {
          const hydrated = profile as UserProfile;
          const nextIdentity = `${hydrated.id}:${hydrated.role}:${hydrated.location_id ?? ''}`;
          adminCache.setIdentity(nextIdentity);
          setUser(hydrated);
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(hydrated));
        } else {
          clearUser();
          supabase.auth.signOut().catch(console.error);
        }
      } catch (error) {
        if (!active || currentRequest !== requestId) return;
        console.error('Failed to hydrate user profile', error);
        clearUser();
      } finally {
        if (active && currentRequest === requestId) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Do not await Supabase work from inside its auth event callback.
      queueMicrotask(() => { void hydrate(session?.user.id ?? null, false); });
    });
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (active) void hydrate(session?.user.id ?? null, true);
    }).catch((error: unknown) => {
      if (!active) return;
      requestId += 1;
      observedAuthUserId = null;
      console.error('Failed to read auth session', error);
      clearUser();
      setLoading(false);
    });

    return () => {
      active = false;
      requestId += 1;
      if (subscription) subscription.unsubscribe();
    };
  }, [supabase]);

  const updateUser = useCallback((updatedData: DisplayProfileFields) => {
    setUser(currentUser => {
      if (!currentUser) return null;
      const { name, phone_number, locationName } = updatedData;
      const newUser = {
        ...currentUser,
        ...(name !== undefined && { name }),
        ...(phone_number !== undefined && { phone_number }),
        ...(locationName !== undefined && { locationName }),
      };
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser));
      return newUser;
    });
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<{ error: AuthError | null }> => {
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      return { error: { message: authError.message === 'Invalid login credentials' ? "Credenciales inválidas." : authError.message } };
    }

    if (data.user) {
      const { data: profile, error: dbError } = await supabase
        .from('profiles')
        .select(PROFILE_FIELDS)
        .eq('id', data.user.id)
        .single();

      if (dbError || !profile) {
        await supabase.auth.signOut();
        return { error: { message: "No se encontró el perfil de usuario." } };
      }

      if (profile.role !== 'admin' && profile.role !== 'worker') {
        await supabase.auth.signOut();
        return { error: { message: "Privilegios insuficientes para acceder al administrador." } };
      }

      const userProfile = profile as UserProfile;
      adminCache.setIdentity(`${userProfile.id}:${userProfile.role}:${userProfile.location_id ?? ''}`);
      setUser(userProfile);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userProfile));



      if (userProfile.role === 'worker') {
        router.replace('/seleccionar-sede');
      } else {
        router.replace('/dashboard');
      }

      return { error: null };
    }

    return { error: { message: "Error de autenticación desconocido." } };
  }, [supabase, router]);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn("Supabase signOut error:", error);
    } finally {
      setUser(null);
      localStorage.removeItem(USER_STORAGE_KEY);
      // Evita que la siguiente sesión vea datos cacheados de esta.
      adminCache.invalidateAll();
      router.replace('/');
    }
  }, [supabase, router]);
  
  return (
    <AuthContext.Provider value={{ user, login, logout, loading, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
