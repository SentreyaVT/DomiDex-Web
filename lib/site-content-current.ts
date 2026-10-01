import { defaultSiteContent, type SiteContent } from './domain';

/** Correct only known obsolete launch text; preserve subsequent operator edits and history. */
export function currentSiteContent(input: Partial<SiteContent>): SiteContent {
  const content = { ...defaultSiteContent, ...input };
  return {
    ...content,
    // The next Play version is deliberately not guessed. Historical update 17 remains readable.
    currentBuild: content.currentBuild === '17' ? '' : content.currentBuild,
    currentVersion: content.currentVersion === '1.0-pre-beta' ? defaultSiteContent.currentVersion : content.currentVersion,
    releaseStatus: content.releaseStatus === 'Pre-Beta' ? defaultSiteContent.releaseStatus : content.releaseStatus,
    statusBanner: ['DomiDex 1.0-pre-beta ist für private Tests verfügbar.', 'DomiDex ist im internen Google-Play-Test verfügbar. Zugang und aktuelle Testversion erhältst du über den Testerprozess in unserer Discord-Community.'].includes(content.statusBanner)
      ? defaultSiteContent.statusBanner : content.statusBanner,
    roadmap: content.roadmap.map((item) => (item.id === 'web' && item.title === 'DomiDex Web' && item.status === 'In Development'
      && item.description === 'Desktop-Sammlung und Binder mit demselben Firebase-Konto.')
      || (item.id === 'pre-beta' && item.title === 'Pre-Beta für Android' && item.status === 'Released'
      && item.description === 'Installierbarer Teststand mit Scanner, Binder, Portfolio und Cloud-Sync.')
      ? { ...item, title: defaultSiteContent.roadmap.find((row) => row.id === item.id)!.title, description: defaultSiteContent.roadmap.find((row) => row.id === item.id)!.description, status: 'Released' as const }
      : item),
  };
}
