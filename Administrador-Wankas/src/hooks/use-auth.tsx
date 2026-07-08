"use client";

import type { UserProfile } from '@/types';
import { createClient } from '@/lib/supabase/client';
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
  updateUser: (updatedData: Partial<UserProfile>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USER_STORAGE_KEY = 'wankas_user';

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
            .select('*')
            .eq('id', session.user.id)
            .single();
          if (profile && (profile.role === 'admin' || profile.role === 'worker')) {
            setUser(profile as UserProfile);
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(profile));
          } else {
            setUser(null);
            localStorage.removeItem(USER_STORAGE_KEY);
            await supabase.auth.signOut();
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
          .select('*')
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

  const updateUser = useCallback((updatedData: Partial<UserProfile>) => {
    setUser(currentUser => {
      if (!currentUser) return null;
      const newUser = { ...currentUser, ...updatedData };
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
        .select('*')
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
    await supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    router.replace('/');
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
