'use client';

import {
  getRedirectResult,
  onIdTokenChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { firebaseAuth, firestore, googleProvider } from '@/lib/firebase-client';

interface AuthState {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  hasScannerLabAccess: boolean;
  isPretester: boolean;
  hasAppAccess: boolean;
  accessError: 'unavailable' | 'timeout' | null;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  refreshClaims: () => Promise<void>;
  reauthenticate: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<Record<string, unknown>>({});
  const [access, setAccess] = useState<Record<string, unknown> | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<AuthState['accessError']>(null);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const generation = useRef(0);
  const observedUid = useRef<string | null>(null);
  const roleAllowed = (role: string) => access !== null && access.disabled !== true && (!(role in access) || access[role] === true);
  const isAdmin = claims.admin === true && roleAllowed('admin');
  const hasScannerLabAccess = isAdmin || (claims.scannerLabAccess === true && roleAllowed('scannerLabAccess'));
  const hasAppAccess = isAdmin || (claims.appAccess === true && roleAllowed('appAccess'));
  const isPretester = isAdmin || (claims.pretester === true && roleAllowed('pretester'));

  const readClaims = useCallback(async (next: User | null, force = false) => {
    // Ignore delayed callbacks/refreshes belonging to a previous account.
    if ((firebaseAuth.currentUser?.uid ?? null) !== (next?.uid ?? null)) return;
    const currentGeneration = ++generation.current;
    const isCurrent = () => currentGeneration === generation.current
      && (firebaseAuth.currentUser?.uid ?? null) === (next?.uid ?? null);
    if (observedUid.current !== (next?.uid ?? null)) {
      observedUid.current = next?.uid ?? null;
      setClaims({}); setAccess(null); setAccessError(null); setAccessLoading(!!next);
    }
    setUser(next);
    try {
      const nextClaims = next ? (await next.getIdTokenResult(force)).claims : {};
      if (isCurrent()) setClaims(nextClaims);
    } catch {
      if (isCurrent()) { setClaims({}); setAccessError('unavailable'); }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void getRedirectResult(firebaseAuth).catch(() => undefined);
    return onIdTokenChanged(firebaseAuth, (next) => void readClaims(next));
  }, [readClaims]);

  useEffect(() => {
    setAccess(null);
    setAccessError(null);
    setAccessLoading(!!user);
    if (!user) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) { setAccess(null); setAccessError('timeout'); setAccessLoading(false); }
    }, 10_000);
    const stop = onSnapshot(doc(firestore, 'accountAccess', user.uid), { includeMetadataChanges: true }, (snapshot) => {
      if (active && !snapshot.metadata.fromCache) {
        window.clearTimeout(timeout); setAccess(snapshot.data() || {}); setAccessError(null); setAccessLoading(false);
      }
    }, () => {
      if (active) { window.clearTimeout(timeout); setAccess(null); setAccessError('unavailable'); setAccessLoading(false); }
    });
    return () => { active = false; window.clearTimeout(timeout); stop(); };
  }, [user, accessAttempt]);

  const value = useMemo<AuthState>(() => ({
    user,
    loading: loading || accessLoading,
    isAdmin,
    hasScannerLabAccess,
    isPretester,
    hasAppAccess,
    accessError,
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
    reauthenticate: async () => {
      const current = firebaseAuth.currentUser;
      if (!current) throw new Error('Bitte zuerst mit deinem Google-Konto anmelden.');
      // A token refresh alone does not renew auth_time. Reconfirm the SAME user
      // without signing out, switching accounts or automatically retrying deletion.
      await reauthenticateWithPopup(current, googleProvider);
      if (firebaseAuth.currentUser?.uid !== current.uid) throw new Error('Das angemeldete Konto hat sich geändert. Bitte erneut prüfen.');
      await current.getIdToken(true);
      if (firebaseAuth.currentUser?.uid !== current.uid) throw new Error('Das angemeldete Konto hat sich geändert. Bitte erneut prüfen.');
      await readClaims(current, true);
      if (firebaseAuth.currentUser?.uid !== current.uid) throw new Error('Das angemeldete Konto hat sich geändert. Bitte erneut prüfen.');
    },
    refreshClaims: async () => {
      setAccess(null); setAccessError(null); setAccessLoading(!!firebaseAuth.currentUser);
      await readClaims(firebaseAuth.currentUser, true);
      // Firestore error callbacks terminate the subscription; refreshing a token alone cannot retry it.
      setAccessAttempt((attempt) => attempt + 1);
    },
  }), [hasAppAccess, hasScannerLabAccess, isAdmin, isPretester, loading, accessLoading, accessError, readClaims, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth muss innerhalb des AuthProvider verwendet werden.');
  return value;
}
