// Cloud Run Node-only operations, deliberately outside frontend/edge bundles.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

interface PrivateOperations {
  uploadReport(request: Request): Promise<Response>;
  readReportImage(request: Request, context: { params: Promise<{ reportId: string }> }): Promise<Response>;
  deletionRequest(request: Request): Promise<Response>;
  deletionStatus(request: Request): Promise<Response>;
}

export async function privateOperations(): Promise<PrivateOperations> {
  const entry = pathToFileURL(resolve(process.cwd(), 'backend/security/routes.mjs')).href;
  return import(/* @vite-ignore */ entry);
}
