import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'https://domidex.web.app';
  return { rules: [{ userAgent: '*', allow: ['/', '/app'], disallow: ['/admin', '/api'] }], sitemap: `${origin}/sitemap.xml` };
}
