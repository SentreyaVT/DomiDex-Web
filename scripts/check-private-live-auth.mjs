import { accessToken, liveAuth } from './privacy-live-context.mjs';
try {
  const auth = liveAuth(accessToken());
  // Signing probe only; this does not create a Firebase user or session.
  const custom = await auth.createCustomToken('privacy-gate-signing-probe');
  console.log(JSON.stringify({ remoteSigningAvailable: typeof custom === 'string' && custom.length > 100 }));
} catch (error) { console.error(JSON.stringify({ remoteSigningAvailable: false, code: error.code || 'SIGNING_UNAVAILABLE' })); process.exitCode = 1; }
