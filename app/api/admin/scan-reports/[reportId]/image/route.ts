import { privateOperations } from '@/lib/server/private-cloud-operations';

export async function GET(request: Request, context: { params: Promise<{ reportId: string }> }) {
  return (await privateOperations()).readReportImage(request, context);
}
