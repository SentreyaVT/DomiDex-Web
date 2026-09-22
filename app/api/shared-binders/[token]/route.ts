import { privateOperations } from '@/lib/server/private-cloud-operations';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return (await privateOperations()).readBinderShare(request, context);
}
