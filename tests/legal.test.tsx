import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalPage } from '@/components/legal-page';
import { deletionRequestHref, legalContact, legalContent, legalNavigation, legalOperator, legalAddress } from '@/lib/legal-content';

describe('Public privacy and account request pages', () => {
  for (const item of legalNavigation) {
    it(`${item.href} renders without AuthProvider, private state or actions`, () => {
      const html = renderToStaticMarkup(<LegalPage type={item.type} />);
      expect(html).toContain(legalContent[item.type].title);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      for (const link of legalNavigation) expect(html).toContain(`href="${link.href}"`);
      expect(html).not.toMatch(/<form|<input|<script|\/api\/|access_token|private_key|file:\/\/|localhost|127\.0\.0\.1/i);
      expect(html).not.toMatch(/rechtliche Zertifizierung|rechtliche Einordnung.*steht noch aus|rechtliche Bewertung.*noch zu prüfen|abschließend zu prüfen/i);
      expect(html).toContain('aria-current="page"');
      expect(new Set(legalContent[item.type].sections.map((section) => section.id)).size).toBe(legalContent[item.type].sections.length);
    });
  }
  it('only prepares a mail draft; does not submit, enumerate or delete accounts', () => {
    const url = new URL(deletionRequestHref);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe(legalContact);
    expect(url.searchParams.get('subject')).toBe('DomiDex – Konto- und Datenlöschung');
    expect(url.searchParams.get('body')).toContain('[bitte selbst eintragen]');
    expect(url.searchParams.get('body')).toContain('noch keine abgeschlossene Löschung');
    expect(url.searchParams.get('body')).not.toMatch(/uid=|token=|password=/i);
  });
  it('does not confuse manual ScanLab reports with separate photo-free Evidence', () => {
    const content = JSON.stringify(legalContent.datenschutz);
    expect(content).toContain('zwei Fehlversuche sind keine Voraussetzung');
    expect(content).toContain('Dieser Hintergrundpfad enthält kein Rohfoto');
    expect(content).toContain('keinen automatischen Fotoversand');
  });
  it('describes explicitly delegated Scanner-Lab readers without granting access to ordinary testers', () => {
    const section = legalContent.datenschutz.sections.find((item) => item.id === 'scanlab');
    const content = JSON.stringify(section);
    expect(content).toContain('ausdrücklich freigeschaltete Scanner-Lab-Mitglieder');
    expect(content).toContain('Ohne diese gesonderte Berechtigung');
    expect(content).toContain('keine öffentliche Bildgalerie');
  });
  it('does not claim complete deletion, anonymous data or a fixed retention job', () => {
    expect(JSON.stringify(legalContent['konto-loeschen'])).toContain('ein Teilfehler wird nicht als vollständige Löschung bestätigt');
    expect(JSON.stringify(legalContent['konto-loeschen'])).toContain('siebentägige technische Wiederherstellungsfrist');
    expect(JSON.stringify(legalContent.datenschutz)).toContain('keine allgemeine automatische Löschfrist');
  });
  it('exposes the same approved support address on all four required pages', () => {
    for (const type of ['datenschutz', 'kontakt', 'impressum', 'konto-loeschen'] as const) {
      const html = renderToStaticMarkup(<LegalPage type={type} />);
      expect(html).toContain(`mailto:${legalContact}`);
      expect(html).toContain(legalOperator);
      expect(html).toContain(legalAddress);
      expect(html).not.toMatch(/Betreiberangaben noch|vollständige Betreiberangaben noch|Betreiberangaben und Prüfstand|Anschrift sind noch nicht bestätigt/i);
    }
  });
});
