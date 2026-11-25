import { reserveAdmission } from './admission-budget.mjs';
import { publishSnapshot } from './snapshot-store.mjs';

/** The trusted publisher entry point: fully validate/serialize, check current
 * source times, reserve the exact immutable wire bytes, then upload and activate.
 * Not an HTTP/client-upload API and not provider authentication. No default
 * client, credentials, network, or storage implementation is created here.
 *
 * Reservation and activation are separate CAS operations. A race or failed
 * upload may consume a slot without activating it; UNKNOWN/partial/orphan work
 * stays charged forever. No reset, release, GC, deletion or lease expiry exists.
 * The fixed 4-generation/1GiB logical wire-byte cap eventually stops publishing;
 * it is NOT a continuous production lifecycle or a physical bucket-cost bound
 * (control objects, versions and storage overhead are not generation wire data).
 * Lifecycle, IAM, rate/deployment policy and end-to-end auth deadlines remain
 * open. A current snapshot is not a promise of historical price restoration.
 */
export async function publishAdmittedSnapshot(storage, input, options) {
  // Capture one primitive data property before any await. Do not run accessors,
  // coerce objects, adopt another attempt, or reread caller-mutated options later.
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Reflect.ownKeys(options).length !== 1) throw new Error('MARKET_PUBLISHER_ATTEMPT_TOKEN');
  const descriptor = Object.getOwnPropertyDescriptor(options, 'attemptToken');
  const token = descriptor?.value;
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') ||
      typeof token !== 'string' || token.length !== 32 || !/^[a-f0-9]{32}$/.test(token)) {
    throw new Error('MARKET_PUBLISHER_ATTEMPT_TOKEN');
  }
  return publishSnapshot(storage, input, { admitGeneration: ({ generation, wireBytes }) =>
    reserveAdmission(storage, { generation, wireBytes, attemptToken: token }) });
}
