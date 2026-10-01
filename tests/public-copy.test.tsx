import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultSiteContent } from '@/lib/domain';
import { legalContent, legalDiscord, legalNavigation } from '@/lib/legal-content';
import Home from '@/app/page';
import { PublicPage } from '@/components/public-page';

vi.mock('@/lib/site-content', () => ({
  useSiteContent: () => ({ content: { ...defaultSiteContent, discordUrl: legalDiscord }, source: 'default' }),
}));

describe('closed-alpha informational copy', () => {
  it('uses the current phase and private tester route without announcing an unverified Play build', () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain('Geschlossene Alpha');
    expect(html).toContain('privaten Tester-Ticket');
    expect(html).toContain(`href="${legalDiscord}"`);
    expect(html).not.toMatch(/Private Pre-Beta|aktuelle Pre-Beta|Coming Soon|Build 26|play\.google\.com\/apps\//);
    expect(defaultSiteContent.currentVersion).toBe('');
    expect(defaultSiteContent.currentBuild).toBe('');
  });
  it('highlights existing binder sharing and documents price gaps instead of promising full coverage', () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain('Private Binder teilen');
    expect(html).toContain('30-Jahre-Set');
    expect(html).toContain('fehlen teilweise noch Werte');
    expect(html).toContain('offline können Änderungen später ankommen');
    expect(html).not.toContain('erzeugen niemals ScanKnowledge');
  });
  it('keeps historical updates separate and omits an empty Build label', () => {
    for (const element of [<Home key="home" />, <PublicPage key="updates" type="updates" />]) {
      const html = renderToStaticMarkup(element);
      expect(html).toContain('Archiv: Start der privaten Testphase');
      expect(html).toContain('Build 17');
      expect(html).not.toContain(' · Build </span>');
      expect(html).not.toContain('Build undefined');
    }
  });
  it('explains link access, optional upload consent and sync limitations independently', () => {
    const html = renderToStaticMarkup(<PublicPage type="faq" />);
    expect(html).toContain(legalDiscord);
    expect(html).toContain('standardmäßig privat');
    expect(html).toContain('Personen mit diesem Link');
    expect(html).toContain('aber nicht bearbeiten');
    expect(html).toContain('Die Testervereinbarung aktiviert keine Bildfreigabe');
    expect(html).toContain('zwischengespeichert');
    expect(html).not.toContain('DomiDex befindet sich in der Pre-Beta');
  });
  it('keeps old information URLs working while displaying current test labels', () => {
    expect(legalNavigation.find((item) => item.type === 'pre-beta')?.href).toBe('/pre-beta');
    expect(legalContent['pre-beta'].title).toBe('Alpha- und Testhinweise');
    expect(JSON.stringify(legalContent)).not.toMatch(/in der Pre-Beta|heutige Pre-Beta|Coming Soon/);
    const sharing = legalContent.datenschutz.sections.find((section) => section.id === 'binder-teilen')!;
    expect(sharing.paragraphs.join(' ')).toContain('ohne eigenes DomiDex-Konto');
    expect(sharing.paragraphs.join(' ')).toContain('standardmäßig ausgeschaltet');
    expect(sharing.paragraphs.join(' ')).toContain('weitergegeben');
    expect(sharing.paragraphs.join(' ')).toContain('nicht zurückholen');
  });
});
