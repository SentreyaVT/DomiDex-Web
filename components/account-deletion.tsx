'use client';

import { useState } from 'react';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { useAuth } from './auth-provider';
import { deletionRequestHref } from '@/lib/legal-content';

export function AccountDeletion() {
  const { user, loading, logout } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function requestDeletion() {
    if (!user || !confirmed || busy) return;
    setBusy(true); setMessage('');
    try {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
      const token = await user.getIdToken(true);
      const response = await fetch('/api/account/delete', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE_DOMIDEX_ACCOUNT' }),
      });
      const result = await response.json() as { status?: string; jobId?: string; error?: string };
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
      if (result.status === 'COMPLETE') await logout();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Der Löschauftrag wurde nicht abgeschlossen.'); }
    finally { setBusy(false); }
  }

  return <main className="admin-page"><header><a href="/app">← Zur Web-App</a><h1>Konto und Daten löschen</h1></header>
    <section className="admin-section"><h2>Dein DomiDex-Konto</h2>
      <p>Die Kontolöschung betrifft deine Sammlung, privaten Binder, Kontoeinstellungen und zugeordneten ScanLab-Daten. Deine Sammlung ist anschließend nicht mehr verfügbar. Sichere vorher Daten, die du behalten möchtest.</p>
      <p>Globale Kartenkataloge und Sammlungen anderer Personen bleiben erhalten. Bei einer erforderlichen Prüfung oder technischen Aufbewahrungsfrist wird der Auftrag noch nicht als abgeschlossen angezeigt.</p>
      <p><a href="/konto-loeschen">Ablauf und Löschfristen nachlesen</a> · <a href="/datenschutz">Datenschutz</a></p>
      {loading ? <p>Kontostatus wird geladen …</p> : !user && !submitted ? <p><a href="/login">Zur Bestätigung anmelden</a> oder <a href={deletionRequestHref}>Löschanfrage ohne Anmeldung senden</a>.</p> : !submitted && <>
        <label className="admin-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Ich möchte mein DomiDex-Konto und die zugehörigen Daten unwiderruflich löschen lassen.</label>
        <button className="danger" disabled={!confirmed || busy} onClick={() => void requestDeletion()}>{busy ? 'Löschauftrag wird geprüft …' : 'Anmeldung bestätigen und Löschauftrag senden'}</button>
      </>}
      {message && <p role="status">{message}</p>}
      <p><a href={deletionRequestHref}>Support zum Löschauftrag kontaktieren</a></p>
    </section>
  </main>;
}

function deletionStatusLabel(status?: string) {
  const labels: Record<string, string> = { STARTED: 'gestartet', IN_PROGRESS: 'in Bearbeitung', WAITING_FOR_TOKEN_EXPIRY: 'Zugriff wird sicher beendet', WAITING_FOR_RETENTION: 'technische Aufbewahrungsfrist', PARTIAL_FAILURE: 'erneute Bearbeitung erforderlich', REVIEW_REQUIRED: 'Zuordnung wird geprüft' };
  return labels[status || ''] || 'in Bearbeitung';
}
