// Cloud Run Node-only operations, deliberately outside frontend/edge bundles.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

interface PrivateOperations {
  createBinderShare(request: Request): Promise<Response>;
  listBinderShares(request: Request): Promise<Response>;
  revokeBinderShare(request: Request): Promise<Response>;
  readBinderShare(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response>;
  authorize(authorization: string | null, role: 'admin' | 'tester' | 'app' | 'scannerLab'): Promise<{ sub: string; admin: boolean; appAccess: boolean; pretester: boolean; scannerLabAccess: boolean }>;
  serverAuthorization(): Promise<string>;
  changeRole(uid: string, role: 'appAccess' | 'pretester' | 'scannerLabAccess', enabled: boolean, authorization: string): Promise<void>;
  uploadReport(request: Request): Promise<Response>;
  readReviewedKnowledge(request: Request): Promise<Response>;
  readReportImage(request: Request, context: { params: Promise<{ reportId: string }> }): Promise<Response>;
  deleteReport(request: Request): Promise<Response>;
  deletionRequest(request: Request): Promise<Response>;
  deletionStatus(request: Request): Promise<Response>;
}

export async function privateOperations(): Promise<PrivateOperations> {
  const entry = pathToFileURL(resolve(process.cwd(), 'backend/security/routes.mjs')).href;
  return import(/* @vite-ignore */ entry);
}
