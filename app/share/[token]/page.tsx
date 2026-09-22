import type { Metadata } from 'next';
import { SharedBinderViewer } from '@/components/shared-binder-viewer';

export const metadata: Metadata = { title: 'Geteilter Binder · DomiDex', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function SharedBinderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Deployment gate also protects the page; server API independently enforces it.
  if (process.env.BINDER_SHARING_READY !== 'verified-v1') return <main><h1>Freigabe nicht verfügbar</h1><p>Dieser Binder ist nicht öffentlich zugänglich.</p><a href="/">Zu DomiDex</a></main>;
  return <SharedBinderViewer token={token} />;
}
