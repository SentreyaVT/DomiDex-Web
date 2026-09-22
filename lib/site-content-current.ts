import { defaultSiteContent, type SiteContent } from './domain';

/** Correct only known obsolete launch text; preserve subsequent operator edits and history. */
export function currentSiteContent(input: Partial<SiteContent>): SiteContent {
  const content = { ...defaultSiteContent, ...input };
  return {
    ...content,
    // The next Play version is deliberately not guessed. Historical update 17 remains readable.
    currentBuild: content.currentBuild === '17' ? '' : content.currentBuild,
    statusBanner: content.statusBanner === 'DomiDex 1.0-pre-beta ist für private Tests verfügbar.'
      ? defaultSiteContent.statusBanner : content.statusBanner,
    roadmap: content.roadmap.map((item) => item.id === 'web' && item.status === 'In Development'
      && item.description === 'Desktop-Sammlung und Binder mit demselben Firebase-Konto.'
      ? { ...item, description: defaultSiteContent.roadmap.find((row) => row.id === 'web')!.description, status: 'Released' as const }
      : item),
  };
}
