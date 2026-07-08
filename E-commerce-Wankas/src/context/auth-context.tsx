'use client';

import type { User } from '@/types';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient'; 
import { clientCache } from '@/lib/clientCache';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (userData: User) => Promise<void>; 
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUserProfile = async (authUserId: string, authUserEmail?: string | null, authUserName?: string | null): Promise<Partial<User>> => {
    if (!supabase) {
      console.warn("Supabase client not available. Cannot fetch user profile.");
      return { id: authUserId, email: authUserEmail, name: authUserName, phone_number: null };
    }
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, name, email, phone_number, role') 
        .eq('id', authUserId)
        .single();

      if (profileError && profileError.code !== 'PGRST116') { 
        console.error("Error fetching user profile from Supabase:", profileError.message);
        return { id: authUserId, email: authUserEmail, name: authUserName, phone_number: null, role: null };
      }
      
      if (profileData) {
        return {
          id: profileData.id, 
          email: profileData.email || authUserEmail,
          name: profileData.name || authUserName,
          phone_number: profileData.phone_number,
          role: profileData.role,
        };
      } else {
        return { id: authUserId, email: authUserEmail, name: authUserName, phone_number: null, role: null };
      }

    } catch (error) {
      console.error("Exception while fetching user profile:", error);
      return { id: authUserId, email: authUserEmail, name: authUserName, phone_number: null };
    }
  };

  const buildUser = async (authUser: { id: string; email?: string | null; user_metadata?: any }): Promise<User> => {
    const profileDetails = await fetchUserProfile(authUser.id, authUser.email, authUser.user_metadata?.name);
    return {
      id: authUser.id,
      email: authUser.email || null,
      name: profileDetails.name || authUser.user_metadata?.name || null,
      phone_number: profileDetails.phone_number || null,
      role: profileDetails.role || null,
    };
  };

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    const initializeAuth = async () => {
      setIsLoading(true);
      try {
        // 1. Try native Supabase localStorage session first
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          const completeUser = await buildUser(session.user);
          setUser(completeUser);
          localStorage.setItem('wankas-user', JSON.stringify(completeUser));
          setIsLoading(false);
          return;
        }
        // 2. No session found
        setUser(null);
        localStorage.removeItem('wankas-user');
      } catch (error) {
        console.error("Failed to initialize auth", error);
        localStorage.removeItem('wankas-user'); 
        setUser(null);
      }
      setIsLoading(false);
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const completeUser = await buildUser(session.user);
        setUser(completeUser);
        localStorage.setItem('wankas-user', JSON.stringify(completeUser));
      } else {
        setUser(null);
        localStorage.removeItem('wankas-user');
      }
      // Invalidar caché del cliente para evitar fuga de estado entre invitados y autenticados
      clientCache.invalidateAll();
    });

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (authData: User) => { 
    setUser(authData);
    localStorage.setItem('wankas-user', JSON.stringify(authData));
  };

  const logout = async () => {
    setUser(null);
    localStorage.removeItem('wankas-user');

    if (supabase) {
      supabase.auth.signOut().catch((error) => {
        console.warn("Supabase signOut error in background:", error);
      });
    }

    if (typeof window !== 'undefined') {
      window.location.href = '/login'; 
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
