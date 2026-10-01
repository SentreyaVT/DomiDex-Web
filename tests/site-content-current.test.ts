import { describe, expect, it } from 'vitest';
import { defaultSiteContent } from '@/lib/domain';
import { currentSiteContent } from '@/lib/site-content-current';
import { legalContent } from '@/lib/legal-content';

describe('verified public test status', () => {
  it('corrects old CMS launch defaults without fabricating a current build', () => {
    const content = currentSiteContent({ currentBuild: '17', statusBanner: 'DomiDex 1.0-pre-beta ist für private Tests verfügbar.', roadmap: [{ id: 'web', title: 'DomiDex Web', description: 'Desktop-Sammlung und Binder mit demselben Firebase-Konto.', status: 'In Development', order: 2 }] });
    expect(content.currentBuild).toBe('');
    expect(content.statusBanner).toContain('internen Google-Play-Test');
    expect(content.roadmap[0].status).toBe('Released');
    expect(content.updates.find((item) => item.build === '17')).toBeDefined();
  });
  it('retains subsequent operator edits and the historical release list', () => {
    const edited = { ...defaultSiteContent, currentBuild: 'confirmed-by-operator', statusBanner: 'Eigener Hinweis', roadmap: [{ id: 'web', title: 'Web Next', description: 'Neue Web-Funktion', status: 'In Development' as const, order: 2 }] };
    expect(currentSiteContent(edited)).toEqual(edited);
  });
  it('retires the old current phase/version without rewriting historical build identities', () => {
    const content = currentSiteContent({ currentVersion: '1.0-pre-beta', releaseStatus: 'Pre-Beta', currentBuild: '17', roadmap: [{ id: 'pre-beta', title: 'Pre-Beta für Android', description: 'Installierbarer Teststand mit Scanner, Binder, Portfolio und Cloud-Sync.', status: 'Released', order: 1 }] });
    expect(content.currentVersion).toBe('');
    expect(content.releaseStatus).toBe('Geschlossene Alpha');
    expect(content.currentBuild).toBe('');
    expect(content.roadmap[0].title).toBe('Geschlossene Alpha für Android');
    expect(content.updates.find((item) => item.build === '17')?.version).toBe('1.0-pre-beta');
    expect(content.updates.filter((item) => item.build && item.build !== '17')).toEqual([]);
  });
  it('documents technical opt-in separately from manual photo permission', () => {
    const sections = legalContent.datenschutz.sections;
    expect(sections.find((item) => item.id === 'evidence')!.paragraphs.join(' ')).toContain('standardmäßig ausgeschaltet');
    expect(sections.find((item) => item.id === 'scanlab')!.paragraphs.join(' ')).toContain('Erst dein ausdrückliches „Hochladen“');
    expect(legalContent['pre-beta'].sections[0].paragraphs.join(' ')).not.toContain('Internal Testing ist noch in Vorbereitung');
  });
  it('preserves operator titles and lifecycle edits even when the old description remains', () => {
    const roadmap = [
      { id: 'web', title: 'Eigener Titel', description: 'Desktop-Sammlung und Binder mit demselben Firebase-Konto.', status: 'In Development' as const, order: 1 },
      { id: 'pre-beta', title: 'Pre-Beta für Android', description: 'Installierbarer Teststand mit Scanner, Binder, Portfolio und Cloud-Sync.', status: 'Experimental' as const, order: 2 },
    ];
    expect(currentSiteContent({ roadmap }).roadmap).toEqual(roadmap);
  });
});
