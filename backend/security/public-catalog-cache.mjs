const publicId = /^[a-zA-Z0-9._-]{1,120}$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const priceFields = ['idProduct', 'unit', 'updated', 'avg', 'low', 'trend', 'avg1', 'avg7', 'avg30',
  'avg-holo', 'low-holo', 'trend-holo'];

/** Only fields consumed by sharedCardDto/domain; no owner document ever enters this module. */
function projectPublicCard(id, source) {
  if (!object(source) || source.id !== id || typeof source.name !== 'string' || typeof source.localId !== 'string'
    || !source.localId || !object(source.set) || typeof source.set.id !== 'string' || !source.set.id
    || typeof source.set.name !== 'string') return null;
  let cacheable = true;
  const card = { id, localId: source.localId, name: source.name, set: { id: source.set.id, name: source.set.name } };
  if (typeof source.image === 'string') card.image = source.image;
  if (source.variants_detailed != null) {
    if (!Array.isArray(source.variants_detailed)) return null;
    card.variants_detailed = source.variants_detailed.map((value) => {
      if (!object(value) || typeof value.type !== 'string') throw Error('INVALID_PUBLIC_VARIANT');
      const variant = { type: value.type };
      for (const field of ['size', 'subtype', 'foil', 'variantId']) if (value[field] !== undefined) {
        // Preserve malformed declared identity instead of dropping a conflict and inventing a price.
        if (value[field] !== null && typeof value[field] !== 'string') cacheable = false;
        variant[field] = value[field];
      }
      if (value.stamp !== undefined) {
        if (!Array.isArray(value.stamp) || value.stamp.some((item) => typeof item !== 'string')) cacheable = false;
        variant.stamp = value.stamp;
      }
      if (value.thirdParty?.cardmarket !== undefined) {
        const declared = value.thirdParty.cardmarket;
        if (declared !== null && (!Number.isSafeInteger(declared) || declared <= 0)) cacheable = false;
        variant.thirdParty = { cardmarket: declared };
      }
      if (value.pricing?.cardmarket != null) {
        if (!object(value.pricing.cardmarket)) { cacheable = false; variant.pricing = { cardmarket: value.pricing.cardmarket }; }
        else {
          const pricing = {};
          for (const field of priceFields) if (value.pricing.cardmarket[field] !== undefined) {
            const raw = value.pricing.cardmarket[field];
            if (raw !== null && (['unit', 'updated'].includes(field) ? typeof raw !== 'string'
              : typeof raw !== 'number' || !Number.isFinite(raw))) cacheable = false;
            if (field === 'idProduct' && raw !== null && (!Number.isSafeInteger(raw) || raw <= 0)) cacheable = false;
            pricing[field] = raw;
          }
          variant.pricing = { cardmarket: pricing };
        }
      }
      return variant;
    });
  }
  // Invalid declared pricing stays uncached and byte-for-byte equivalent in value semantics:
  // JSON would turn Infinity/NaN into null, potentially removing a product-ID contradiction.
  if (!cacheable) return { value: structuredClone(card), cacheable: false };
  // JSON bytes, not mutable provider objects, own cache storage and every consumer gets a copy.
  return { bytes: Buffer.from(JSON.stringify(card), 'utf8'), cacheable: true };
}

/** Bounds actual load promises, including untracked overflow, not sockets or other replicas. */
function createLoaderPool(maxActive, maxQueued) {
  let active = 0;
  const queue = [];
  function drain() {
    while (active < maxActive && queue.length) start(queue.shift());
  }
  function start(item) {
    item.signal.removeEventListener('abort', item.aborted);
    if (item.signal.aborted) { item.resolve(null); return; }
    active++;
    const release = () => { active--; drain(); };
    // A consumer timeout ends its cache job immediately, but never releases this
    // permit before the original loader settles (even if it ignores abort).
    Promise.resolve().then(() => item.signal.aborted ? null : item.task()).then(
      value => { release(); item.resolve(value); },
      error => { release(); item.reject(error); },
    );
  }
  return (task, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { resolve(null); return; }
    const item = { task, signal, resolve, reject, aborted: null };
    item.aborted = () => {
      const index = queue.indexOf(item);
      if (index < 0) return;
      queue.splice(index, 1);
      signal.removeEventListener('abort', item.aborted);
      resolve(null);
    };
    if (active < maxActive) start(item);
    else if (queue.length < maxQueued) {
      queue.push(item);
      signal.addEventListener('abort', item.aborted, { once: true });
    } else resolve(null); // Transient overload, never a negative cache entry.
  });
}

/** Process-local public metadata only. Byte/load bounds are not a total heap or socket bound. */
export function createPublicCatalogCache({ load, now = () => performance.now(), ttlMs = 60_000,
  maxEntries = 8_192, maxBytes = 32 * 1024 * 1024, maxEntryBytes = 128 * 1024,
  maxInFlight = 64, jobTimeoutMs = 12_000, maxActiveLoads = 32, maxQueuedLoads = 512 }) {
  if (typeof load !== 'function' || typeof now !== 'function' ||
    [ttlMs, maxEntries, maxBytes, maxEntryBytes, maxInFlight, jobTimeoutMs, maxActiveLoads, maxQueuedLoads]
      .some((n) => !Number.isSafeInteger(n) || n < 1)) {
    throw Error('INVALID_PUBLIC_CACHE_CONFIGURATION');
  }
  const pooledLoad = createLoaderPool(maxActiveLoads, maxQueuedLoads);
  const entries = new Map(), inFlight = new Map();
  let totalBytes = 0;
  function remove(key) {
    const existing = entries.get(key);
    if (existing) { totalBytes -= existing.bytes.length; entries.delete(key); }
  }
  function remember(key, projected) {
    if (!projected?.cacheable || projected.bytes.length > maxEntryBytes || projected.bytes.length > maxBytes) return;
    const storedAt = now();
    if (!Number.isFinite(storedAt)) return;
    remove(key);
    while (entries.size >= maxEntries || totalBytes + projected.bytes.length > maxBytes) remove(entries.keys().next().value);
    entries.set(key, { bytes: projected.bytes, storedAt, expiresAt: storedAt + ttlMs });
    totalBytes += projected.bytes.length;
  }
  const copy = (bytes) => bytes ? JSON.parse(bytes.toString('utf8')) : null;

  function createJob(key, id, tracked, mode) {
    const controller = new AbortController();
    const job = { controller, waiters: new Set(), settled: false };
    job.finish = (projected, successful = false) => {
      if (job.settled) return;
      job.settled = true;
      clearTimeout(timer);
      if (tracked && inFlight.get(key) === job) inFlight.delete(key);
      if (successful && tracked && !controller.signal.aborted) remember(key, projected);
      for (const waiter of job.waiters) waiter.complete(projected);
      job.waiters.clear();
    };
    job.cancel = () => { controller.abort(); job.finish(null); };
    if (tracked) inFlight.set(key, job);
    const timer = setTimeout(() => job.cancel(), jobTimeoutMs);
    timer.unref?.();
    Promise.resolve().then(() => job.settled ? null : pooledLoad(
      () => mode === 'raw' ? load(id, controller.signal) : load(id, controller.signal, mode), controller.signal))
      .then((value) => {
        // Late provider completion after timeout/last-consumer cancellation cannot warm a new generation.
        if (!job.settled) job.finish(projectPublicCard(id, value), true);
      }).catch(() => job.finish(null));
    return job;
  }

  function join(job, signal) {
    return new Promise((resolve) => {
      let done = false;
      const waiter = { complete: (projected) => {
        if (done) return;
        done = true; signal?.removeEventListener('abort', aborted); job.waiters.delete(waiter);
        resolve(projected?.bytes ? copy(projected.bytes) : projected?.value ? structuredClone(projected.value) : null);
      } };
      const aborted = () => {
        waiter.complete(null);
        if (!job.settled && job.waiters.size === 0) job.cancel();
      };
      job.waiters.add(waiter);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
    });
  }

  async function get(id, signal, mode = 'raw') {
    if (!['raw', 'prices'].includes(mode) || typeof id !== 'string' || !publicId.test(id) || signal?.aborted) return null;
    // Two public resolver modes share one budget; no owner, binder, token or private selection.
    const key = `tcgdex:de:v2:${mode}:${id}`;
    const cached = entries.get(key), at = now();
    if (cached) {
      if (Number.isFinite(at) && at >= cached.storedAt && at < cached.expiresAt) {
        entries.delete(key); entries.set(key, cached); // LRU only; original expiry does not move.
        return copy(cached.bytes);
      }
      remove(key);
    }
    let job = inFlight.get(key);
    // Dedup overflow stays uncached but shares the bounded loader pool. Queue time
    // consumes the original job deadline; actual pool overflow returns uncached null.
    if (!job) job = createJob(key, id, inFlight.size < maxInFlight, mode);
    return join(job, signal);
  }
  return { get, stats: () => ({ entries: entries.size, bytes: totalBytes, inFlight: inFlight.size }) };
}
