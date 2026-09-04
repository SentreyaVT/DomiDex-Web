import { privateOperations } from '@/lib/server/private-cloud-operations';

export async function POST(request: Request) {
  return (await privateOperations()).uploadReport(request);
}
