"use client";

import type { UserProfile } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { adminCache } from '@/lib/adminCache';
import { useRouter } from 'next/navigation';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

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
  const supabase = createClient();

  useEffect(() => {
    const initializeAuth = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select(PROFILE_FIELDS)
            .eq('id', session.user.id)
            .single();
          if (profile && (profile.role === 'admin' || profile.role === 'worker')) {
            setUser(profile as UserProfile);
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profile));
          } else {
            setUser(null);
            localStorage.removeItem(USER_STORAGE_KEY);
            supabase.auth.signOut().catch(console.error);
          }
        } else {
          setUser(null);
          localStorage.removeItem(USER_STORAGE_KEY);
        }
      } catch (error) {
        console.error("Failed to parse user session", error);
        localStorage.removeItem(USER_STORAGE_KEY);
        setUser(null);
      }
      setLoading(false);
    };
    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select(PROFILE_FIELDS)
          .eq('id', session.user.id)
          .single();
        if (profile && (profile.role === 'admin' || profile.role === 'worker')) {
          setUser(profile as UserProfile);
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profile));
        } else {
          setUser(null);
          localStorage.removeItem(USER_STORAGE_KEY);
        }
      } else {
        setUser(null);
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    });

    return () => {
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
