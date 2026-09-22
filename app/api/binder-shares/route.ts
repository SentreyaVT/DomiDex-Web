import { privateOperations } from '@/lib/server/private-cloud-operations';

export const runtime = 'nodejs';
export async function GET(request: Request) { return (await privateOperations()).listBinderShares(request); }
export async function POST(request: Request) { return (await privateOperations()).createBinderShare(request); }
export async function DELETE(request: Request) { return (await privateOperations()).revokeBinderShare(request); }
