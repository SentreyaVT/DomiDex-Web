'use client';

import { useEffect, useMemo, useState } from 'react';
import { alternativePriceCandidates, collectionPriceMetricLabel, type AlternativePriceCandidate, type CollectionPriceSelection } from '@/lib/price-alternatives';
import type { TcgCardDetail, TcgVariant } from '@/lib/domain';

export function PriceAlternativePicker({ card, variant, selection, disabled = false, confirmLabel = 'Auswahl bestätigen', successLabel = 'Preiskennzahl bestätigt.', onConfirm, onClear, onError }: {
  card: TcgCardDetail;
  variant: TcgVariant;
  selection?: CollectionPriceSelection | null;
  disabled?: boolean;
  confirmLabel?: string;
  successLabel?: string;
  onConfirm: (candidate: AlternativePriceCandidate) => void | Promise<void>;
  onClear?: () => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  const candidates = useMemo(() => alternativePriceCandidates(card, variant), [card, variant]);
  const [metric, setMetric] = useState<AlternativePriceCandidate['metric'] | ''>('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { setMetric(''); setConfirmed(false); }, [card.id, variant.variantId, variant.type]);
  const candidate = candidates.find((item) => item.metric === metric);
  const activeSelection = selection && !selection.cleared ? selection : null;
  const sourceAt = candidate?.sourceAt ?? candidates[0]?.sourceAt ?? activeSelection?.sourceAt ?? null;
  const values = candidates.map((item) => item.amountMinor);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const materiallyDifferent = minimum > 0 && maximum - minimum >= 100 && maximum / minimum >= 1.5;
  const confirm = async () => {
    if (!candidate) return;
    setBusy(true); setConfirmed(false);
    try { await onConfirm(candidate); setConfirmed(true); }
    catch (error) { onError?.(error instanceof Error ? error.message : 'Die Preiskennzahl konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    if (!onClear) return;
    setBusy(true); setConfirmed(false);
    try { await onClear(); setMetric(''); }
    catch (error) { onError?.(error instanceof Error ? error.message : 'Die Preiskennzahl konnte nicht entfernt werden.'); }
    finally { setBusy(false); }
  };
  return <section className="price-alternative-picker" aria-label="Alternative Cardmarket-Preiskennzahl">
    <p>Kein Trendpreis verfügbar. Du kannst bewusst eine andere Cardmarket-Kennzahl derselben Karte und Variante auswählen.</p>
    <small>Nur Vergleichswert aus dem Cardmarket-Preisguide – kein garantierter Verkaufs- oder Ankaufspreis.</small>
    {sourceAt && <small>Datenstand der Preisquelle: {formatDate(sourceAt)}</small>}
    {activeSelection && <small>Aktuell gespeichert: {collectionPriceMetricLabel(activeSelection.metric!)} · {formatPrice(activeSelection.amountMinor! / 100)}. Für eine neue Bestätigung bitte erneut bewusst auswählen.</small>}
    {materiallyDifferent && <small className="price-alternative-warning" role="status">Die Werte weichen deutlich ab: {formatPrice(minimum / 100)} bis {formatPrice(maximum / 100)}. Bitte bewusst vergleichen und bestätigen.</small>}
    {candidates.length ? <>
      <label><span>Preiskennzahl</span><select value={metric} disabled={disabled || busy} onChange={(event) => { setMetric(event.target.value as AlternativePriceCandidate['metric'] | ''); setConfirmed(false); }}><option value="" disabled>Preiskennzahl auswählen …</option>{candidates.map((item) => <option value={item.metric} key={item.metric}>{item.label} · {formatPrice(item.amountMinor / 100)}</option>)}</select></label>
      <button type="button" disabled={disabled || busy || !candidate} onClick={() => void confirm()}>{busy ? 'Wird gespeichert …' : confirmLabel}</button>
    </> : <p className="price-alternative-empty" role="status">Für diese exakte Kartenvariante ist keine bestätigbare Cardmarket-Ersatzkennzahl verfügbar.</p>}
    {activeSelection && onClear && <button type="button" className="price-alternative-clear" disabled={disabled || busy} onClick={() => void clear()}>Gespeicherte Auswahl entfernen</button>}
    {confirmed && <small className="price-alternative-success" role="status">{successLabel}</small>}
  </section>;
}

function formatPrice(value: number) { return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value); }
function formatDate(value: number) { return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
