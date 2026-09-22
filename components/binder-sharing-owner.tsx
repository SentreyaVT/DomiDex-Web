'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { ShareOptions } from '@/lib/shared-binder';
import styles from './binder-sharing-owner.module.css';

type Binder = { binderId: string; name: string; coverStyle: string };
type Share = { shareId: string; createdAt: number; options: ShareOptions };
const defaults: ShareOptions = { showPrices: false, showTotal: false, showDisplayName: false };
const publicOrigin = 'https://domidex.web.app';

/** Only explicit owner actions create/revoke links; no local storage or collection writes. */
export function BinderSharingOwner({ user }: { user: Pick<User, 'uid' | 'getIdToken'> }) {
  const [binders, setBinders] = useState<Binder[]>([]);
  const [binderId, setBinderId] = useState('');
  const [shares, setShares] = useState<Share[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesFailed, setSharesFailed] = useState(false);
  const [options, setOptions] = useState<ShareOptions>(defaults);
  const [displayName, setDisplayName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [revokeId, setRevokeId] = useState('');
  const [link, setLink] = useState<{ shareId: string; url: string } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const scope = useRef(`${user.uid}|${binderId}`);
  scope.current = `${user.uid}|${binderId}`;

  const request = useCallback(async (query: string, method = 'GET', payload?: unknown, signal?: AbortSignal) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('REQUEST_TIMEOUT')); }, 15_000); });
    try {
      return await Promise.race([deadline, (async () => {
        const token = await user.getIdToken();
        const response = await fetch(`/api/binder-shares${query}`, {
          method, cache: 'no-store', credentials: 'omit', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        if (!response.ok) throw new Error(response.status === 404 ? 'UNAVAILABLE' : 'REQUEST_FAILED');
        return response.json() as Promise<{ binders?: Binder[]; shares?: Share[]; path?: string; shareId?: string; createdAt?: number; options?: ShareOptions }>;
      })()]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }, [user]);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setStatus('loading'); setBinders([]); setBinderId(''); setShares([]); setLink(null); setNotice(''); setBusy(false);
    setOptions(defaults); setDisplayName(''); setConfirmed(false); setRevokeId('');
    void request('', 'GET', undefined, controller.signal).then((data) => {
      if (controller.signal.aborted || current !== generation.current) return;
      setBinders(data.binders ?? []); setBinderId(data.binders?.[0]?.binderId ?? ''); setStatus('ready');
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && current === generation.current) setStatus(error instanceof Error && error.message === 'UNAVAILABLE' ? 'unavailable' : 'error');
    });
    return () => { controller.abort(); };
  }, [request, attempt]);

  useEffect(() => {
    setShares([]); setSharesLoading(!!binderId); setSharesFailed(false); setLink(null); setNotice(''); setOptions(defaults); setDisplayName(''); setConfirmed(false); setRevokeId('');
    if (!binderId) return;
    const controller = new AbortController();
    void request(`?binderId=${encodeURIComponent(binderId)}`, 'GET', undefined, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setShares(data.shares ?? []); setSharesLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setSharesLoading(false); setSharesFailed(true); setNotice('Aktive Freigaben konnten nicht geladen werden. Bitte aktualisieren.'); } });
    return () => controller.abort();
  }, [binderId, request]);

  async function create() {
    if (!binderId || !confirmed || busy || sharesLoading || sharesFailed || status !== 'ready') return;
    const currentScope = scope.current;
    setBusy(true); setNotice('');
    try {
      const data = await request('', 'POST', { binderId, confirm: true, ...options, ...(options.showDisplayName ? { displayName: displayName.trim() } : {}) });
      if (scope.current !== currentScope) return;
      if (!data.path || !/^\/share\/[A-Za-z0-9_-]{43}$/.test(data.path) || !data.shareId || !data.options || typeof data.createdAt !== 'number') throw new Error('INVALID_RESPONSE');
      setLink({ shareId: data.shareId, url: `${publicOrigin}${data.path}` });
      setShares((current) => [...current, { shareId: data.shareId!, createdAt: data.createdAt!, options: data.options! }]);
      setConfirmed(false); setNotice('Freigabe erstellt. Kopiere den Link jetzt – er wird nur einmal angezeigt.');
    } catch { if (scope.current === currentScope) { setConfirmed(false); setSharesFailed(true); setNotice('Freigabe konnte nicht bestätigt werden. Aktualisiere vor einem erneuten Versuch die aktiven Freigaben.'); } }
    finally { if (scope.current === currentScope) setBusy(false); }
  }
  async function revoke(shareId: string) {
    if (busy || revokeId !== shareId) return;
    const currentScope = scope.current;
    setBusy(true); setNotice('');
    try {
      await request('', 'DELETE', { shareId, confirm: true });
      if (scope.current !== currentScope) return;
      setShares((current) => current.filter((share) => share.shareId !== shareId));
      setLink((current) => current?.shareId === shareId ? null : current); setRevokeId(''); setNotice('Freigabe beendet. Der Link ist serverseitig ungültig.');
    } catch { if (scope.current === currentScope) setNotice('Freigabe konnte nicht beendet werden. Bitte erneut versuchen.'); }
    finally { if (scope.current === currentScope) setBusy(false); }
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setNotice('Freigabelink kopiert.'); }
    catch { setNotice('Bitte markiere und kopiere den Link im Feld.'); }
  }
  const invalidName = options.showDisplayName && (!displayName.trim() || displayName.trim().length > 60 || /[@\r\n]/.test(displayName));
  return <section className={styles.panel} aria-labelledby="private-sharing-title">
    <header><div><p>PRIVATE BINDER</p><h2 id="private-sharing-title">Deinen Binder teilen</h2></div><button disabled={busy} onClick={() => setAttempt((value) => value + 1)}>Freigaben aktualisieren</button></header>
    {status === 'loading' ? <p role="status">Private Binder werden geladen …</p> : status === 'unavailable' ? <p role="status">Binder-Freigaben sind noch nicht aktiviert. Deine Binder bleiben privat.</p> : status === 'error' ? <p role="alert">Private Binder konnten nicht geladen werden. Bitte erneut versuchen.</p> : !binders.length ? <p>Noch kein privater Binder synchronisiert. Erstelle einen privaten Binder in der DomiDex-App.</p> : <>
      <label className={styles.field}>Privater Binder<select value={binderId} disabled={busy} onChange={(event) => setBinderId(event.target.value)}>{binders.map((binder) => <option value={binder.binderId} key={binder.binderId}>{binder.name}</option>)}</select></label>
      <p>Wer den Link erhält, kann Cover, Karten und Seiten ansehen. Bearbeiten ist nicht möglich. Besitzmengen, Kaufdaten und private Notizen werden nicht geteilt.</p>
      <fieldset disabled={busy} className={styles.options}><legend>Zusätzlich ausdrücklich freigeben</legend>
        <label><input type="checkbox" checked={options.showPrices} onChange={(event) => setOptions({ ...options, showPrices: event.target.checked })} /> Aktuelle öffentliche Kartenpreise anzeigen</label>
        <label><input type="checkbox" checked={options.showTotal} onChange={(event) => setOptions({ ...options, showTotal: event.target.checked })} /> Aktuellen Binder-Gesamtwert anzeigen</label>
        <label><input type="checkbox" checked={options.showDisplayName} onChange={(event) => setOptions({ ...options, showDisplayName: event.target.checked })} /> Anzeigename anzeigen</label>
        {options.showDisplayName && <label className={styles.field}>Öffentlicher Anzeigename<input maxLength={60} autoComplete="off" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Keine E-Mail-Adresse" /></label>}
      </fieldset>
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /> Ich möchte diesen Binder mit diesen Angaben per Link zum Ansehen freigeben.</label>
      <button disabled={!confirmed || invalidName || busy || sharesLoading || sharesFailed} onClick={() => void create()}>{busy ? 'Wird verarbeitet …' : 'Freigabelink erstellen'}</button>
      {link && <div className={styles.link}><label className={styles.field}>Dein neuer Freigabelink<input readOnly value={link.url} onFocus={(event) => event.target.select()} /></label><button onClick={() => void copy()}>Link kopieren</button></div>}
      <h3>Aktive Freigaben ({shares.length})</h3>
      {sharesLoading ? <p role="status">Aktive Freigaben werden geladen …</p> : sharesFailed ? <p>Freigabestatus nicht verfügbar.</p> : shares.length === 0 ? <p>Keine aktive Freigabe für diesen Binder.</p> : <ul className={styles.list}>{shares.map((share) => <li key={share.shareId}>
        <div><strong>{new Date(share.createdAt).toLocaleString('de-DE')}</strong><p>{[share.options.showPrices ? 'Kartenpreise' : null, share.options.showTotal ? 'Binderwert' : null, share.options.showDisplayName ? 'Anzeigename' : null].filter(Boolean).join(' · ') || 'Ohne Preise, Binderwert und Anzeigename'}</p></div>
        {revokeId === share.shareId ? <div><p>Dieser Freigabelink wird ungültig. Fortfahren?</p><button disabled={busy} onClick={() => void revoke(share.shareId)}>Beenden bestätigen</button><button disabled={busy} onClick={() => setRevokeId('')}>Abbrechen</button></div> : <button disabled={busy} onClick={() => setRevokeId(share.shareId)}>Freigabe beenden</button>}
      </li>)}</ul>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
