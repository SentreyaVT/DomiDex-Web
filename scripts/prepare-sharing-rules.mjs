/** Prepare only the reviewed minimal sharing compatibility delta; never deploys. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const EXPECTED_LIVE_SHA256 = 'f2456cca3d02a74a057f927969156049bee545dbe43d67d1961c5669791cbde9';
export const sha256 = text => createHash('sha256').update(text).digest('hex');
const placementFields = "          'placementId', 'ownerUid', 'binderId', 'entrySyncId', 'slotPosition',\n          'createdAtClient', 'updatedAtClient', 'deleted', 'revision', 'lastMutationId', 'updatedAt'\n        ])";
const placementPosition = '        && data.slotPosition is int && data.slotPosition >= 0';
const holoValidation = `
        && (data.get('holoEffectId', null) == null
          || (data.get('holoEffectId', null) is string
            && data.get('holoEffectId', null).matches('[A-Za-z0-9][A-Za-z0-9._-]{0,79}')))
        && data.get('holoIntensity', 0) is number
        && data.get('holoIntensity', 0) >= 0
        && data.get('holoIntensity', 0) <= 1
        && (data.get('holoEffectId', null) != null || data.get('holoIntensity', 0) == 0)`;
const denyComment = '    // Default deny. Admin SDK is the only moderation/publication/claim-management path.';
const accountRead = `    // Own access status is readable; all access grants remain server-owned.
    match /accountAccess/{uid} {
      allow get: if request.auth != null && request.auth.uid == uid;
      allow list, create, update, delete: if false;
    }

`;

export function prepareSharingRules(snapshot) {
  if (sha256(snapshot) !== EXPECTED_LIVE_SHA256) throw new Error('LIVE_RULES_CHANGED: re-read and review; never patch an unknown ruleset.');
  if (snapshot.split(placementFields).length !== 3) throw new Error('Expected identical placement hasOnly/hasAll field lists.');
  if (snapshot.split(placementPosition).length !== 2 || snapshot.split(denyComment).length !== 2) throw new Error('Expected unique reviewed anchors.');
  // Replace first occurrence only: hasOnly gains optional fields; hasAll stays unchanged.
  return snapshot
    .replace(placementFields, placementFields.replace("'createdAtClient'", "'holoEffectId', 'holoIntensity', 'createdAtClient'"))
    .replace(placementPosition, placementPosition + holoValidation)
    .replace(denyComment, accountRead + denyComment);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve('.domidex/sharing-activation');
  const input = readFileSync(resolve(directory, 'live-firestore.rules'), 'utf8');
  const candidate = prepareSharingRules(input);
  const target = resolve(directory, 'sharing-candidate.rules');
  writeFileSync(target, candidate);
  writeFileSync(resolve(directory, 'firebase.sharing-candidate.json'), JSON.stringify({
    firestore: { rules: 'sharing-candidate.rules' },
    emulators: { firestore: { port: 8080 }, ui: { enabled: false }, singleProjectMode: false },
  }, null, 2));
  const metadata = { preparedAt: new Date().toISOString(), sourceSha256: sha256(input), candidateSha256: sha256(candidate),
    target, changes: ['own accountAccess get only', 'optional bounded placement holoEffectId/holoIntensity'], deployed: false };
  writeFileSync(resolve(directory, 'sharing-candidate-metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata));
}
