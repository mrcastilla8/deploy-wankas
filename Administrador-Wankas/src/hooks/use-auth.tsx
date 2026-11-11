"use client";

import type { UserProfile } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { adminCache } from '@/lib/adminCache';
import { useRouter } from 'next/navigation';
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AuthOperationGate } from '@/lib/authOperationGate';

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
  const operationGate = useRef(new AuthOperationGate());
  const explicitAuthIntent = useRef<{ kind: 'login' | 'logout'; operation: number } | null>(null);
  const authSubjectId = useRef<string | null>(null);

  useEffect(() => {
    const gate = operationGate.current;
    gate.activate();
    explicitAuthIntent.current = null;
    const clearUser = () => {
      adminCache.setIdentity(null);
      setUser(null);
      localStorage.removeItem(USER_STORAGE_KEY);
    };
    const hydrate = async (authUserId: string | null, operation: number, showLoading: boolean) => {
      if (!gate.isCurrent(operation)) return;
      if (authSubjectId.current !== authUserId) {
        authSubjectId.current = authUserId;
        clearUser();
      }
      if (showLoading) setLoading(true);
      if (!authUserId) {
        clearUser();
        if (gate.isCurrent(operation)) setLoading(false);
        return;
      }
      try {
        const { data: profile } = await supabase.from('profiles').select(PROFILE_FIELDS)
          .eq('id', authUserId).single();
        const published = gate.publishIfCurrent(operation, () => {
          if (profile && (profile.role === 'admin' || profile.role === 'worker')) {
            const hydrated = profile as UserProfile;
            const nextIdentity = `${hydrated.id}:${hydrated.role}:${hydrated.location_id ?? ''}`;
            // No conservar datos previos mientras se resuelve una identidad distinta.
            adminCache.setIdentity(nextIdentity);
            setUser(hydrated);
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(hydrated));
          } else {
            clearUser();
            void supabase.auth.signOut().catch(console.error);
          }
        });
        if (!published) return;
      } catch (error) {
        if (!gate.publishIfCurrent(operation, () => {
          console.error('Failed to hydrate user profile', error);
          clearUser();
        })) return;
      } finally {
        if (gate.isCurrent(operation)) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Login/logout explícitos ya tienen una operación vigente propia. Los
      // eventos de esas operaciones no deben competir con su resolución.
      if (explicitAuthIntent.current) return;
      const operation = gate.begin();
      // El evento puede quedar encolado respecto de otro cambio de sesión;
      // leer la sesión actual evita hidratar el user del payload obsoleto.
      queueMicrotask(() => {
        void supabase.auth.getSession().then(({ data: { session } }) => {
          if (gate.isCurrent(operation)) void hydrate(session?.user.id ?? null, operation, false);
        }).catch((error: unknown) => {
          if (!gate.isCurrent(operation)) return;
          console.error('Failed to refresh auth session', error);
          clearUser();
          setLoading(false);
        });
      });
    });
    const initialOperation = gate.begin();
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (gate.isCurrent(initialOperation)) void hydrate(session?.user.id ?? null, initialOperation, true);
    }).catch((error: unknown) => {
      if (!gate.isCurrent(initialOperation)) return;
      console.error('Failed to read auth session', error);
      clearUser();
      setLoading(false);
    });

    return () => {
      gate.deactivate();
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
    const gate = operationGate.current;
    const operation = gate.begin();
    explicitAuthIntent.current = { kind: 'login', operation };
    authSubjectId.current = null;
    adminCache.setIdentity(null);
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (!gate.isCurrent(operation)) return { error: null };
      if (authError) {
        return { error: { message: authError.message === 'Invalid login credentials' ? 'Credenciales inválidas.' : authError.message } };
      }
      if (!data.user) return { error: { message: 'Error de autenticación desconocido.' } };

      const { data: profile, error: dbError } = await supabase.from('profiles').select(PROFILE_FIELDS)
        .eq('id', data.user.id).single();
      if (!gate.isCurrent(operation)) return { error: null };
      if (dbError || !profile) {
        await supabase.auth.signOut();
        if (!gate.isCurrent(operation)) return { error: null };
        return { error: { message: 'No se encontró el perfil de usuario.' } };
      }
      if (profile.role !== 'admin' && profile.role !== 'worker') {
        await supabase.auth.signOut();
        if (!gate.isCurrent(operation)) return { error: null };
        return { error: { message: 'Privilegios insuficientes para acceder al administrador.' } };
      }

      const userProfile = profile as UserProfile;
      authSubjectId.current = userProfile.id;
      adminCache.setIdentity(`${userProfile.id}:${userProfile.role}:${userProfile.location_id ?? ''}`);
      setUser(userProfile);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userProfile));
      if (userProfile.role === 'worker') router.replace('/seleccionar-sede');
      else router.replace('/dashboard');
      return { error: null };
    } catch {
      if (!gate.isCurrent(operation)) return { error: null };
      return { error: { message: 'No se pudo completar el inicio de sesión. Inténtalo de nuevo.' } };
    } finally {
      if (gate.isCurrent(operation)) {
        explicitAuthIntent.current = null;
        setLoading(false);
      }
    }
  }, [supabase, router]);

  const logout = useCallback(async () => {
    const gate = operationGate.current;
    const operation = gate.begin();
    explicitAuthIntent.current = { kind: 'logout', operation };
    authSubjectId.current = null;
    adminCache.setIdentity(null);
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    setLoading(false);
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn("Supabase signOut error:", error);
    } finally {
      if (gate.isCurrent(operation)) {
        setUser(null);
        explicitAuthIntent.current = null;
        router.replace('/');
      }
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
