import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DomiDex TCG', short_name: 'DomiDex', description: 'Die offizielle DomiDex Website und Desktop-Sammlung.',
    start_url: '/', display: 'standalone', background_color: '#050610', theme_color: '#8138f4',
    icons: [{ src: '/favicon.jpg', sizes: '512x512', type: 'image/jpeg' }],
  };
}
