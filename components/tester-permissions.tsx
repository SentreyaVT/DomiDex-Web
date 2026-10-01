'use client';

import { Check, LoaderCircle, Search, ShieldAlert, UserCheck, UserMinus } from 'lucide-react';
import { type SyntheticEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth-provider';

interface ManagedUser { uid: string; email: string; displayName: string | null; admin: boolean; pretester: boolean; appAccess: boolean; scannerLabAccess: boolean; createdAt: string | null; lastLoginAt: string | null; }
type PermissionField = 'pretester' | 'appAccess' | 'scannerLabAccess';
const permissionLabels: Record<PermissionField, string> = { pretester: 'Testerfreigabe', appAccess: 'Web-App-Zugang', scannerLabAccess: 'Scanner-Lab-Zugang' };

export function TesterPermissions() {
  const { user, loading, isAdmin, refreshClaims } = useAuth();
  const [email, setEmail] = useState(''); const [found, setFound] = useState<ManagedUser | null>(null);
  const [testers, setTesters] = useState<ManagedUser[]>([]); const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');

  const authorized = useCallback(async (input: string, init?: RequestInit) => {
    if (!user) throw new Error('Anmeldung erforderlich.');
    const token = await user.getIdToken();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(input, { ...init, headers });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'Anfrage fehlgeschlagen.');
    return body as Record<string, unknown>;
  }, [user]);

  const load = useCallback(async (pageToken?: string) => {
    const query = pageToken ? `?pageSize=1000&pageToken=${encodeURIComponent(pageToken)}` : '?pageSize=1000';
    const body = await authorized(`/api/admin/testers${query}`) as unknown as { users: ManagedUser[]; nextPageToken: string | null };
    setTesters((current) => pageToken ? [...current, ...body.users.filter((item) => !current.some((existing) => existing.uid === item.uid))] : body.users);
    setNextPageToken(body.nextPageToken);
  }, [authorized]);

  useEffect(() => { if (isAdmin) void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Tester konnten nicht geladen werden.')); }, [isAdmin, load]);
  if (loading) return <main className="admin-gate"><LoaderCircle className="spin" /><p>Berechtigungen werden geprüft …</p></main>;
  if (!user) return <main className="admin-gate"><ShieldAlert /><h1>Anmeldung erforderlich</h1><a href="/login">Zum Login</a></main>;
  if (!isAdmin) return <main className="admin-gate"><ShieldAlert /><h1>403 · Zugriff verweigert</h1><button onClick={() => void refreshClaims()}>Berechtigung erneut prüfen</button></main>;

  const search = async (event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const body = await authorized('/api/admin/testers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }) as unknown as { user: ManagedUser }; setFound(body.user); } catch (reason) { setFound(null); setError(reason instanceof Error ? reason.message : 'Nutzer konnte nicht gefunden werden.'); } finally { setBusy(false); } };
  const update = async (target: ManagedUser, field: PermissionField, enabled: boolean) => { if (field === 'scannerLabAccess' && enabled && !window.confirm(`Scanner-Lab-Zugang für ${target.displayName || 'Ohne Anzeigename'} (${target.email || 'Keine E-Mail'}) freigeben?\n\nDie Freigabe erlaubt das Ansehen und Bearbeiten übermittelter Fehlscans einschließlich privater Fotos anderer Nutzer. Sie gewährt keine allgemeinen Administratorrechte, keine Profiländerungen und kein Löschen von Reports.`)) return; if (!enabled && !window.confirm(`${permissionLabels[field]} für ${target.displayName || target.email} wirklich entziehen?`)) return; setBusy(true); setError(''); setMessage(''); try { const body = await authorized('/api/admin/testers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: target.uid, [field]: enabled }) }) as unknown as { user: ManagedUser }; setFound((current) => current?.uid === target.uid ? body.user : current); setTesters((current) => (body.user.pretester || body.user.appAccess || body.user.scannerLabAccess) ? [...current.filter((item) => item.uid !== target.uid), body.user] : current.filter((item) => item.uid !== target.uid)); setMessage(`${permissionLabels[field]} wurde ${enabled ? 'freigeschaltet' : 'entfernt'}. ${enabled ? 'Zum Freischalten Berechtigungen aktualisieren oder neu anmelden.' : 'Die Sperre gilt serverseitig auch für bisherige Sitzungen.'}`); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Berechtigung konnte nicht geändert werden.'); } finally { setBusy(false); } };

  return <main className="admin-page tester-page"><header><a href="/admin">← Administration</a><div><p>SICHERER BEREICH</p><h1>Tester & Berechtigungen</h1></div></header>{message && <div className="admin-success"><Check />{message}</div>}{error && <div className="form-error">{error}</div>}<section className="admin-section wide"><h2>Firebase-Nutzer suchen</h2><p>Scanner-Lab-Zugang erlaubt das Ansehen und Bearbeiten übermittelter Fehlscans einschließlich privater Fotos anderer Nutzer. Allgemeine Administratorrechte, Profiländerungen und das Löschen von Reports bleiben Administratoren vorbehalten.</p><form className="tester-search" onSubmit={search}><label className="admin-field"><span>E-Mail-Adresse</span><input type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tester@example.com" /></label><button disabled={busy || !email.trim()}>{busy ? <LoaderCircle className="spin" /> : <Search />} Suchen</button></form>{found && <UserRow user={found} busy={busy} onChange={update} />}</section><section className="admin-section wide"><h2>Freigeschaltete Nutzer</h2>{testers.length ? <div className="tester-list">{testers.map((item) => <UserRow user={item} busy={busy} onChange={update} key={item.uid} />)}</div> : <p className="admin-empty">Noch keine Tester-, Web- oder Scanner-Lab-Zugänge in der geladenen Auth-Seite.</p>}{nextPageToken && <button className="admin-add" disabled={busy} onClick={() => void load(nextPageToken).catch((reason) => setError(String(reason)))}>Weitere Auth-Seite laden</button>}</section></main>;
}

function UserRow({ user, busy, onChange }: { user: ManagedUser; busy: boolean; onChange: (user: ManagedUser, field: PermissionField, enabled: boolean) => void }) {
  return <article className="tester-row"><div><strong>{user.displayName ?? 'Ohne Anzeigename'}</strong><span>{user.email || 'Keine E-Mail'}</span><code>{user.uid}</code></div><div className="tester-claims"><em className={user.admin ? 'active' : ''}>ADMIN {user.admin ? '✓' : '—'}</em><em className={user.pretester ? 'active' : ''}>PRETESTER {user.pretester ? '✓' : '—'}</em><em className={user.appAccess ? 'active' : ''}>WEB {user.appAccess || user.admin ? '✓' : '—'}</em><em className={user.scannerLabAccess || user.admin ? 'active' : ''}>SCANNER LAB {user.scannerLabAccess || user.admin ? '✓' : '—'}</em></div><div className="tester-actions"><button disabled={busy} className={user.pretester ? 'danger' : ''} onClick={() => onChange(user, 'pretester', !user.pretester)}>{user.pretester ? <UserMinus /> : <UserCheck />}{user.pretester ? 'Tester entfernen' : 'Tester freigeben'}</button><button disabled={busy || user.admin} className={user.appAccess ? 'danger' : ''} onClick={() => onChange(user, 'appAccess', !user.appAccess)}>{user.appAccess ? <UserMinus /> : <UserCheck />}{user.appAccess ? 'Web sperren' : 'Web freigeben'}</button><button disabled={busy || user.admin} className={user.scannerLabAccess ? 'danger' : ''} onClick={() => onChange(user, 'scannerLabAccess', !user.scannerLabAccess)}>{user.scannerLabAccess ? <UserMinus /> : <UserCheck />}{user.scannerLabAccess || user.admin ? 'Scanner Lab sperren' : 'Scanner Lab freigeben'}</button></div></article>;
}
