import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFile } from 'node:fs/promises';

const uid = process.env.DOMIDEX_ADMIN_UID?.trim();
if (!uid) throw new Error('DOMIDEX_ADMIN_UID fehlt. Melde dich einmal in DomiDex Web an und setze anschließend deine Firebase UID nur lokal.');

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const credential = serviceAccountPath
  ? cert(JSON.parse(await readFile(serviceAccountPath, 'utf8')))
  : applicationDefault();

if (!getApps().length) initializeApp({ credential, projectId: 'cardvault-715ac' });
const auth = getAuth();
const user = await auth.getUser(uid);
await auth.setCustomUserClaims(uid, { ...user.customClaims, admin: true });
console.log('Admin-Claim wurde gesetzt. Bitte in DomiDex Web ab- und wieder anmelden.');
