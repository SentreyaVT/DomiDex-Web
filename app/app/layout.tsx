import { AuthProvider } from '@/components/auth-provider';
export default function WebAppLayout({children}:{children:React.ReactNode}){return <AuthProvider>{children}</AuthProvider>}
