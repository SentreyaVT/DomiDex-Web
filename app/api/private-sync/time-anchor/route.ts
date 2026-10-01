import { privateOperations } from '@/lib/server/private-cloud-operations';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  return (await privateOperations()).readPrivateSyncTimeAnchor(request);
}
