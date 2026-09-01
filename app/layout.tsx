import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'DomiDex TCG · Deine Sammlung. Überall.',
  description: 'Die offizielle Website von DomiDex – Android-Kartenscanner, Binder, Portfolio und Desktop-Sammlung.',
  applicationName: 'DomiDex TCG',
  icons: { icon: '/favicon.jpg', apple: '/favicon.jpg' },
  openGraph: {
    type: 'website', locale: 'de_DE', siteName: 'DomiDex TCG',
    title: 'DomiDex TCG · Deine Sammlung. Überall.',
    description: 'Android-Kartenscanner, Binder, Portfolio und Desktop-Sammlung mit einem gemeinsamen Konto.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'DomiDex TCG – Deine Sammlung. Deine Karten. Überall.' }],
  },
  twitter: { card: 'summary_large_image', title: 'DomiDex TCG', description: 'Deine Sammlung. Deine Karten. Überall.', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de" className="dark"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
