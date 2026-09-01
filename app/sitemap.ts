import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return ['', '/updates', '/roadmap', '/faq', '/impressum', '/datenschutz', '/kontakt'].map((path) => ({ url: `${origin}${path}`, lastModified: new Date(), changeFrequency: path ? 'monthly' : 'weekly', priority: path ? .7 : 1 }));
}
