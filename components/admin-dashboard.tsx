'use client';

import { ArrowLeft, Check, LoaderCircle, Plus, Save, ScanLine, ShieldAlert, Trash2, UserRoundCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from './auth-provider';
import { defaultSiteContent, type RoadmapItem, type SiteContent, type SiteUpdate } from '@/lib/domain';
import { useSiteContent } from '@/lib/site-content';

export function AdminDashboard() {
  const { user, loading, isAdmin, refreshClaims } = useAuth();
  const { content } = useSiteContent();
  const [draft, setDraft] = useState<SiteContent>(defaultSiteContent);
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => setDraft(content), [content]);

  if (loading) return <main className="admin-gate"><LoaderCircle className="spin" /><p>Administratorrolle wird geprüft …</p></main>;
  if (!user) return <main className="admin-gate"><ShieldAlert /><h1>Anmeldung erforderlich</h1><p>Melde dich zuerst mit deinem DomiDex-Google-Konto an.</p><a href="/login">Zum Login</a></main>;
  if (!isAdmin) return <main className="admin-gate"><ShieldAlert /><h1>403 · Zugriff verweigert</h1><p>Dieser Bereich benötigt den serverseitigen Firebase Custom Claim <code>admin: true</code>.</p><button onClick={() => void refreshClaims()}>Berechtigung erneut prüfen</button><a href="/app">Zur Web App</a></main>;

  const save = async () => {
    setSaving(true); setMessage(''); setError('');
    try {
      const token = await user.getIdToken(true);
      const response = await fetch('/api/admin/site-content', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Speichern fehlgeschlagen.');
      setMessage('Öffentliche Website wurde aktualisiert.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Speichern fehlgeschlagen.'); }
    finally { setSaving(false); }
  };

  const patch = <K extends keyof SiteContent>(key: K, value: SiteContent[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return <main className="admin-page"><header><a href="/app"><ArrowLeft /> Web App</a><div><p>SICHERER BEREICH</p><h1>DomiDex Administration</h1></div><button disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <Save />} Speichern</button></header>{message && <div className="admin-success"><Check />{message}</div>}{error && <div className="form-error">{error}</div>}<div className="admin-grid">
    <section className="admin-section wide scanner-lab-entry"><div><ScanLine /><span><small>ENGINEERING CONTROL</small><h2>Scanner Control Center</h2><p>Lokale Referenzkarten kalibrieren, Zonen gewichten und Profile kontrolliert versionieren.</p></span></div><a href="/admin/scanner-lab">Scanner Lab öffnen</a></section>
    <section className="admin-section wide scanner-lab-entry"><div><UserRoundCog /><span><small>FIREBASE AUTH</small><h2>Tester & Berechtigungen</h2><p>Firebase-Nutzer exakt auflösen und ausschließlich den Pretester-Claim verwalten.</p></span></div><a href="/admin/testers">Berechtigungen öffnen</a></section>
    <AdminSection title="Website"><Field label="Hero-Text" value={draft.heroTitle} onChange={(value)=>patch('heroTitle',value)} /><TextArea label="Untertitel" value={draft.heroSubtitle} onChange={(value)=>patch('heroSubtitle',value)} /><TextArea label="Statusbanner" value={draft.statusBanner} onChange={(value)=>patch('statusBanner',value)} /><div className="field-row"><Field label="Version" value={draft.currentVersion} onChange={(value)=>patch('currentVersion',value)} /><Field label="Build" value={draft.currentBuild} onChange={(value)=>patch('currentBuild',value)} /><Field label="Status" value={draft.releaseStatus} onChange={(value)=>patch('releaseStatus',value)} /></div></AdminSection>
    <AdminSection title="Community & Links"><Field label="Discord Invite (öffentlich)" value={draft.discordUrl} onChange={(value)=>patch('discordUrl',value)} /><TextArea label="Community-Text" value={draft.discordText} onChange={(value)=>patch('discordText',value)} /><Field label="GitHub Projekt/Release" value={draft.githubUrl} onChange={(value)=>patch('githubUrl',value)} /><Field label="Kickstarter URL (leer = Coming Soon)" value={draft.kickstarterUrl} onChange={(value)=>patch('kickstarterUrl',value)} /><Field label="Kickstarter CTA" value={draft.kickstarterCta} onChange={(value)=>patch('kickstarterCta',value)} /></AdminSection>
    <AdminSection title="Updates" wide><button className="admin-add" onClick={() => patch('updates',[...draft.updates,newUpdate()])}><Plus /> Update erstellen</button><div className="admin-items">{draft.updates.map((update,index)=><UpdateEditor key={update.id} value={update} onChange={(value)=>patch('updates',replaceAt(draft.updates,index,value))} onDelete={()=>patch('updates',draft.updates.filter((_,item)=>item!==index))} />)}</div></AdminSection>
    <AdminSection title="Roadmap" wide><button className="admin-add" onClick={() => patch('roadmap',[...draft.roadmap,newRoadmap(draft.roadmap.length)])}><Plus /> Eintrag erstellen</button><div className="admin-items">{[...draft.roadmap].sort((a,b)=>a.order-b.order).map((item,index)=><RoadmapEditor key={item.id} value={item} onChange={(value)=>patch('roadmap',draft.roadmap.map((existing)=>existing.id===item.id?value:existing))} onDelete={()=>patch('roadmap',draft.roadmap.filter((existing)=>existing.id!==item.id))} index={index} />)}</div></AdminSection>
  </div></main>;
}

function AdminSection({ title, wide=false, children }:{title:string;wide?:boolean;children:React.ReactNode}){return <section className={`admin-section ${wide?'wide':''}`}><h2>{title}</h2>{children}</section>}
function Field({label,value,onChange,type='text'}:{label:string;value:string;onChange:(value:string)=>void;type?:string}){return <label className="admin-field"><span>{label}</span><input type={type} value={value} onChange={(event)=>onChange(event.target.value)} /></label>}
function TextArea({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <label className="admin-field"><span>{label}</span><textarea rows={3} value={value} onChange={(event)=>onChange(event.target.value)} /></label>}
function UpdateEditor({value,onChange,onDelete}:{value:SiteUpdate;onChange:(value:SiteUpdate)=>void;onDelete:()=>void}){const set=<K extends keyof SiteUpdate>(key:K,next:SiteUpdate[K])=>onChange({...value,[key]:next});return <article className="admin-item"><button className="delete" onClick={onDelete} aria-label="Update löschen"><Trash2 /></button><div className="field-row"><Field label="Titel" value={value.title} onChange={(next)=>set('title',next)} /><Field label="Datum" value={value.date} type="date" onChange={(next)=>set('date',next)} /><Field label="Version" value={value.version} onChange={(next)=>set('version',next)} /><Field label="Build" value={value.build} onChange={(next)=>set('build',next)} /></div><TextArea label="Zusammenfassung" value={value.summary} onChange={(next)=>set('summary',next)} /><TextArea label="Details" value={value.details} onChange={(next)=>set('details',next)} /><div className="field-row"><Field label="Bild URL (optional)" value={value.imageUrl??''} onChange={(next)=>set('imageUrl',next)} /><Field label="Link (optional)" value={value.linkUrl??''} onChange={(next)=>set('linkUrl',next)} /><label className="admin-check"><input type="checkbox" checked={value.active} onChange={(event)=>set('active',event.target.checked)} /> Veröffentlicht</label></div></article>}
function RoadmapEditor({value,onChange,onDelete,index}:{value:RoadmapItem;onChange:(value:RoadmapItem)=>void;onDelete:()=>void;index:number}){const set=<K extends keyof RoadmapItem>(key:K,next:RoadmapItem[K])=>onChange({...value,[key]:next});return <article className="admin-item"><button className="delete" onClick={onDelete} aria-label="Roadmap-Eintrag löschen"><Trash2 /></button><div className="field-row"><Field label="Titel" value={value.title} onChange={(next)=>set('title',next)} /><label className="admin-field"><span>Status</span><select value={value.status} onChange={(event)=>set('status',event.target.value as RoadmapItem['status'])}>{['Released','In Development','Planned','Experimental'].map((status)=><option key={status}>{status}</option>)}</select></label><label className="admin-field"><span>Reihenfolge</span><input type="number" value={value.order} onChange={(event)=>set('order',Number(event.target.value)||index)} /></label></div><TextArea label="Beschreibung" value={value.description} onChange={(next)=>set('description',next)} /></article>}
function replaceAt<T>(items:T[],index:number,value:T){return items.map((item,current)=>current===index?value:item)}
function newUpdate():SiteUpdate{return{id:crypto.randomUUID(),title:'Neues Update',date:new Date().toISOString().slice(0,10),version:'',build:'',summary:'',details:'',active:false}}
function newRoadmap(order:number):RoadmapItem{return{id:crypto.randomUUID(),title:'Neuer Roadmap-Punkt',description:'',status:'Planned',order}}
