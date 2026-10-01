'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, reauthenticateWithPopup } from 'firebase/auth';
import { useAuth } from './auth-provider';
import { deletionRequestHref } from '@/lib/legal-content';
import { firebaseAuth } from '@/lib/firebase-client';

export function AccountDeletion() {
  const { user, loading, logout } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const session = useRef({
    uid: firebaseAuth.currentUser?.uid ?? null, generation: 0, active: false,
    request: undefined as object | undefined,
  });
  const observeOwner = useCallback((uid: string | null) => {
    if (session.current.uid === uid) return;
    session.current.uid = uid;
    session.current.generation += 1;
    session.current.request = undefined;
    setConfirmed(false); setBusy(false); setMessage(''); setSubmitted(false);
  }, []);
  useEffect(() => {
    let active = true;
    const observedSession = session.current;
    observedSession.active = true;
    // Observe UID transitions independently of React batching: A -> B -> A is
    // a different confirmation session. Same-owner reauthentication stays valid.
    const stop = onAuthStateChanged(firebaseAuth, (next) => { if (active) observeOwner(next?.uid ?? null); });
    return () => {
      active = false;
      observedSession.active = false;
      observedSession.generation += 1;
      observedSession.request = undefined;
      stop();
    };
  }, [observeOwner]);
  useEffect(() => observeOwner(user?.uid ?? null), [user?.uid, observeOwner]);

  async function requestDeletion() {
    if (!user || loading || !confirmed || busy || submitted || session.current.request
      || !session.current.active || session.current.uid !== user.uid || firebaseAuth.currentUser?.uid !== user.uid) return;
    const ownerUid = user.uid;
    const generation = session.current.generation;
    const request = {};
    session.current.request = request;
    const isCurrent = () => session.current.active && session.current.generation === generation
      && session.current.request === request && session.current.uid === ownerUid
      && firebaseAuth.currentUser?.uid === ownerUid;
    setBusy(true); setMessage('');
    try {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
      if (!isCurrent()) return;
      const token = await user.getIdToken(true);
      if (!isCurrent()) return;
      const response = await fetch('/api/account/delete', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE_DOMIDEX_ACCOUNT' }),
      });
      // An already sent server request cannot be undone by switching accounts.
      // Its late result must never update or sign out the new local session.
      if (!isCurrent()) return;
      const result = await response.json() as { status?: string; jobId?: string; error?: string };
      if (!isCurrent()) return;
      if (!response.ok) {
        const explanations: Record<string, string> = {
          DELETION_DISABLED: 'Die direkte Kontolöschung ist derzeit nicht freigegeben. Du kannst unten eine Löschanfrage senden.',
          RECENT_LOGIN_REQUIRED: 'Bitte melde dich erneut an und bestätige den Löschauftrag.',
          REVIEW_REQUIRED: 'Der Auftrag benötigt eine Zuordnungsprüfung. Bitte kontaktiere den Support; es wurde noch nichts gelöscht.',
        };
        throw new Error(explanations[result.error || result.status || ''] || 'Der Löschauftrag konnte nicht abgeschlossen werden. Bitte kontaktiere den Support.');
      }
      setSubmitted(true);
      setMessage(result.status === 'COMPLETE'
        ? 'Die Kontolöschung wurde abgeschlossen.'
        : `Dein Löschauftrag wurde aufgenommen. Status: ${deletionStatusLabel(result.status)}. Die vollständige Löschung ist noch nicht bestätigt. Referenz: ${result.jobId || 'siehe Support'}.`);
      if (result.status === 'COMPLETE' && isCurrent()) await logout();
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof Error ? error.message : 'Der Löschauftrag wurde nicht abgeschlossen.');
    } finally {
      if (isCurrent()) { session.current.request = undefined; setBusy(false); }
    }
  }

  return <main className="admin-page"><header><a href="/app">← Zur Web-App</a><h1>Konto und Daten löschen</h1></header>
    <section className="admin-section"><h2>Dein DomiDex-Konto</h2>
      <p>Die Kontolöschung betrifft deine Sammlung, privaten Binder, Kontoeinstellungen und zugeordneten ScanLab-Daten. Deine Sammlung ist anschließend nicht mehr verfügbar. Sichere vorher Daten, die du behalten möchtest.</p>
      <p>Globale Kartenkataloge und Sammlungen anderer Personen bleiben erhalten. Bei einer erforderlichen Prüfung oder technischen Aufbewahrungsfrist wird der Auftrag noch nicht als abgeschlossen angezeigt.</p>
      <p><a href="/konto-loeschen">Ablauf und Löschfristen nachlesen</a> · <a href="/datenschutz">Datenschutz</a></p>
      {loading ? <p>Kontostatus wird geladen …</p> : !user && !submitted ? <p><a href="/login">Zur Bestätigung anmelden</a> oder <a href={deletionRequestHref}>Löschanfrage ohne Anmeldung senden</a>.</p> : !submitted && <>
        <label className="admin-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(
          event.target.checked && !!user && session.current.active && session.current.uid === user.uid
          && firebaseAuth.currentUser?.uid === user.uid,
        )} /> Ich möchte mein DomiDex-Konto und die zugehörigen Daten unwiderruflich löschen lassen.</label>
        <button className="danger" disabled={!confirmed || busy} onClick={() => void requestDeletion()}>{busy ? 'Löschauftrag wird geprüft …' : 'Anmeldung bestätigen und Löschauftrag senden'}</button>
      </>}
      {message && <p role="status">{message}</p>}
      <p><a href={deletionRequestHref}>Support zum Löschauftrag kontaktieren</a></p>
    </section>
  </main>;
}

function deletionStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    STARTED: 'gestartet', IN_PROGRESS: 'in Bearbeitung',
    PENDING_SESSION_EXPIRY: 'Zugriff wird sicher beendet',
    ACTIVE_DATA_DELETED_PENDING_PROVIDER_RETENTION: 'technische Wiederherstellungsfrist beim Speicheranbieter',
    PROVIDER_PURGE_NOT_CONFIRMED: 'endgültige Entfernung beim Speicheranbieter noch nicht bestätigt',
    WAITING_FOR_TOKEN_EXPIRY: 'Zugriff wird sicher beendet', WAITING_FOR_RETENTION: 'technische Aufbewahrungsfrist',
    PARTIAL_FAILURE: 'erneute Bearbeitung erforderlich', REVIEW_REQUIRED: 'Zuordnung wird geprüft',
  };
  return labels[status || ''] || 'in Bearbeitung';
}
