'use client';

import { ArrowLeft, LoaderCircle, LogIn, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';

export default function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => { if (!loading && user) router.replace('/app'); }, [loading, router, user]);

  return (
    <main className="auth-page">
      <a href="/" className="auth-back"><ArrowLeft /> Zur offiziellen Website</a>
      <section className="auth-card">
        <img src="/domidex-logo.jpg" alt="DomiDex" />
        <p className="eyebrow"><span /> EIN KONTO · EINE SAMMLUNG</p>
        <h1>Willkommen bei<br /><em>DomiDex Web</em></h1>
        <p>Melde dich mit demselben Google-Konto an, das du in der Android-App verwendest.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="google-button" disabled={loading} onClick={() => {
          setError('');
          void signIn().catch(() => setError('Die Google-Anmeldung konnte nicht abgeschlossen werden.'));
        }}>
          {loading ? <LoaderCircle className="spin" /> : <LogIn />} Mit Google anmelden
        </button>
        <div className="auth-note"><ShieldCheck /> Firebase Authentication schützt den Zugriff. DomiDex Web besitzt kein separates Passwort und kein Schattenkonto.</div>
      </section>
    </main>
  );
}
