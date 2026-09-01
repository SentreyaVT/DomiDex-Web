'use client';

import {
  getRedirectResult,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { firebaseAuth, googleProvider } from '@/lib/firebase-client';

interface AuthState {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  refreshClaims: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setAdmin] = useState(false);

  const readClaims = useCallback(async (next: User | null, force = false) => {
    setUser(next);
    setAdmin(next ? (await next.getIdTokenResult(force)).claims.admin === true : false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void getRedirectResult(firebaseAuth).catch(() => undefined);
    return onIdTokenChanged(firebaseAuth, (next) => void readClaims(next));
  }, [readClaims]);

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    isAdmin,
    signIn: async () => {
      try {
        await signInWithPopup(firebaseAuth, googleProvider);
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
        if (code.includes('popup-blocked') || code.includes('operation-not-supported')) {
          await signInWithRedirect(firebaseAuth, googleProvider);
          return;
        }
        throw error;
      }
    },
    logout: () => signOut(firebaseAuth),
    refreshClaims: async () => readClaims(firebaseAuth.currentUser, true),
  }), [isAdmin, loading, readClaims, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth muss innerhalb des AuthProvider verwendet werden.');
  return value;
}
