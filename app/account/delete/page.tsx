import { AuthProvider } from '@/components/auth-provider';
import { AccountDeletion } from '@/components/account-deletion';

export const metadata = { title: 'Konto löschen · DomiDex', robots: { index: false, follow: false } };
export default function Page() { return <AuthProvider><AccountDeletion /></AuthProvider>; }
