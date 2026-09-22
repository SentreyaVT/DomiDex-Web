'use client';

import { useEffect, useState } from 'react';
import { defaultSiteContent, type SiteContent } from './domain';
import { currentSiteContent } from './site-content-current';

export function useSiteContent() {
  const [content, setContent] = useState(defaultSiteContent);
  const [source, setSource] = useState<'default' | 'firebase'>('default');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/site-content', { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<SiteContent> : defaultSiteContent)
      .then((next) => { setContent(currentSiteContent(next)); setSource('firebase'); })
      .catch(() => setSource('default'));
    return () => controller.abort();
  }, []);

  return { content, source };
}
