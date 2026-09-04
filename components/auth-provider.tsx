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
  isPretester: boolean;
  hasAppAccess: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  refreshClaims: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setAdmin] = useState(false);
  const [isPretester, setPretester] = useState(false);
  const [hasAppAccess, setAppAccess] = useState(false);

  const readClaims = useCallback(async (next: User | null, force = false) => {
    setUser(next);
    const claims = next ? (await next.getIdTokenResult(force)).claims : {};
    setAdmin(claims.admin === true);
    setPretester(claims.pretester === true);
    setAppAccess(claims.appAccess === true || claims.admin === true);
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
    isPretester,
    hasAppAccess,
    signIn: async () => {
      try {
        await signInWithPopup(firebaseAuth, googleProvider);
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
        if (code.includes('popup-blocked') || code.includes('operation-not-supported') || code.includes('web-storage-unsupported')) {
          await signInWithRedirect(firebaseAuth, googleProvider);
          return;
        }
        throw error;
      }
    },
    logout: () => signOut(firebaseAuth),
    refreshClaims: async () => readClaims(firebaseAuth.currentUser, true),
  }), [hasAppAccess, isAdmin, isPretester, loading, readClaims, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth muss innerhalb des AuthProvider verwendet werden.');
  return value;
}
