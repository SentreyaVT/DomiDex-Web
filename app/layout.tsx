import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://domidex.web.app'),
  title: 'DomiDex · Deine Karten. Deine Sammlung. Dein Binder.',
  description: 'Die offizielle Website von DomiDex – Android-Kartenscanner, Binder, Portfolio und Desktop-Sammlung.',
  applicationName: 'DomiDex',
  icons: { icon: '/favicon.jpg', apple: '/favicon.jpg' },
  openGraph: {
    type: 'website', locale: 'de_DE', siteName: 'DomiDex',
    title: 'DomiDex · Deine Karten. Deine Sammlung. Dein Binder.',
    description: 'Android-Kartenscanner, Binder, Portfolio und Desktop-Sammlung mit einem gemeinsamen Konto.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'DomiDex – Deine Karten. Deine Sammlung. Dein Binder.' }],
  },
  twitter: { card: 'summary_large_image', title: 'DomiDex', description: 'Deine Karten. Deine Sammlung. Dein Binder.', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de" className="dark"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
