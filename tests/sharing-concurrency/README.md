# Shared-binder concurrency simulation

Run from the Web repository with its locked dependencies installed:

```sh
node tests/sharing-concurrency/run.mjs 3
```

The optional argument is 1–3 repetitions (default 3). This invokes the actual
`readBinderShare` handler and public catalog cache. Firestore/Auth are deterministic
doubles; the only allowed fetch is an exact synthetic catalog URL with a 2 ms timer.
No account, emulator, production network, application data or configuration is used.
The runner excludes environment files and credential variables and uses the existing
sharing-scale network guard. This is **not** a distributed Cloud Run load test.

Each of 10/40/80 concurrent requests is measured for:

- the same nine-card page of a 5,000-placement binder;
- separate nine-card pages of a 1,000-placement binder;
- the opt-in total of a 200-placement binder.

Cold and warm cycles are separate. The total-value fixture is deliberately 200,
not a claimed 80-client, 5,000-card total benchmark. Tests also cover revocation
during catalog work and separation of private options between two synthetic owners.

## Historical root verification before raw/prices partitioning, 2026-10-01

**11/11 PASS**, 12.34 s. Three repetitions produce 54 cold/warm batches and one
revocation batch: 2,350 measured handler calls. A separate ten-request owner-isolation
test is not included in those metrics. Raw reports (ignored local output):

`outputs/sharing-concurrency/2026-10-01T03-23-31-232Z-20888.{log,metrics.json}`.

| Scenario, 80 simultaneous calls | Logical document reads per batch | Cold / warm provider calls | Maximum cold provider concurrency |
| --- | ---: | ---: | ---: |
| Same page, 5,000 placements | 401,360 | 9 / 0 | 9 |
| Separate pages, 1,000 placements | 81,360 | 720 / 592 | 480 |
| Opt-in total, 200 placements | 32,640 | 200 / 0 | 6 |

Across all measured batches: 5,028,810 logical document reads, 8,063 fake provider
calls, maximum response JSON 3,322 bytes. Maximum sampled process RSS was 547.06 MiB.
These are fixture operation counts and process samples, **not billed Firestore
reads, production payload limits, or a guaranteed server-memory bound**.

Example batch wall times for the three 80-request repetitions:

- Same page: cold 221.23 / 210.88 / 277.19 ms; warm 169.47 / 196.49 / 227.60 ms.
- Separate pages: cold 332.87 / 142.03 / 111.47 ms; warm 142.33 / 99.15 / 81.19 ms.
- Opt-in total: cold 587.03 / 569.53 / 621.28 ms; warm 163.29 / 169.52 / 174.71 ms.

Per-request min/median/P95/max and memory samples are in the JSON. Fixture assertions,
module loading, JavaScript scheduling and GC contribute to these numbers; 5 ms memory
sampling misses short peaks. The fake provider delay is not a provider/network SLA.
Warm is not universally faster across runs. No 500 ms production target is declared
passed from this simulation, and no autoscaling or quota has been changed.

## Gate 6 resolver-mode contract and current verification, 2026-10-01

The later, deliberate public-cache partition distinguishes unresolved `raw` data
from enriched `prices` data within the same cache budgets. The historical mixed-owner
test above expected nine cold fetches across both modes. Re-running it against that
new contract produced **10 PASS / 1 FAIL**: the actual 18 fetches were correct for
two separate nine-card modes, not a privacy or authorization failure. Evidence:
`outputs/sharing-concurrency/2026-10-01T04-29-40-534Z-14744.{log,metrics.json}`.

Only this obsolete expectation and its explanatory contract were updated. The
mixed-owner test now requires **18 cold / 0 additional warm fetches**, with each
owner retaining its own price visibility. A separate same-mode two-owner case
requires **9 cold / 0 additional warm fetches**. Both cold and warm runs retain all
private reads, Auth calls, DTO privacy assertions and opt-ins; the other ten
concurrency/revocation scenarios are unchanged. The two owner tests now issue
40 handler calls outside the unchanged 2,350-call structured metric batches.

Current isolated result: **12/12 PASS**, 14.62 s, default three repetitions.
Reports: `outputs/sharing-concurrency/2026-10-01T04-31-30-334Z-2832.{log,metrics.json}`.
The historical 11-test result and measurements above describe the earlier contract,
not this latest run. An Android test build could run concurrently; elapsed times
must not be compared as a performance improvement or regression. No production
code, limits, Rules, dependencies, network or deployment were changed by this
test-only correction.

## Bounded actual loader follow-up, 2026-10-01

The historical 64-job limit only tracked deduplication. The cache now adds a FIFO
pool covering **all actual loader promises**, including uncached overflow and both
`raw`/`prices` modes: **32 active / 512 queued per cache instance**. Queue time counts
against the original 12-second job deadline. An active abort-ignoring loader keeps
its permit until its original promise settles; a queued abort is removed immediately.
Overflow returns transient, uncached unavailability, never an invented price.
Cache hits, the 64 tracked jobs, TTL, byte budgets and private authorization stay
unchanged. This bounds loader promises, not physical sockets, total heap, all HTTP
requests or a deployment containing multiple replicas.

Root tested 16, 32 and 64 active slots sequentially with the same actual-handler
fixture, synthetic 2-ms provider and three repetitions. All configurations pass
12/12 cases, all expected cards/prices, revocation and owner-isolation assertions.
The 55 measured batches retain 2,350 requests, 5,028,810 logical document reads and
8,063 fake provider calls. Forty separate owner-test calls remain outside the metrics.

| Active slots | 80 disjoint readers: cold wall ms, three repetitions | Warm wall ms | Peak fake provider calls |
| --- | --- | --- | ---: |
| 16 (rejected initial setting) | 775.78 / 773.97 / 772.51 | 623.44 / 638.79 / 657.20 | 16 |
| 32 (selected local default) | 383.78 / 428.33 / 416.26 | 330.86 / 359.12 / 359.30 | 32 |
| 64 (comparison only) | 226.29 / 259.52 / 260.42 | 239.17 / 235.19 / 232.72 | 64 |

Reports in `outputs/sharing-concurrency/`:

- `2026-10-01T14-36-39-796Z-12672.{log,metrics.json}` (16; 19.10 s)
- `2026-10-01T14-43-17-373Z-21232.{log,metrics.json}` (32; 15.94 s)
- `2026-10-01T14-44-20-993Z-9348.{log,metrics.json}` (64; 14.85 s)

The conservative 32 setting halves the potential active body/parse load relative
to 64 and avoids the much longer synthetic queue at 16. It is **not** a measured
provider/Cloud Run optimum. Limiting work deliberately increases burst latency
relative to some historical unbounded runs; do not market this as a universal
speedup or declare a production 500-ms target met. In particular, many anniversary
requests can occupy all slots while awaiting the shared guide's separate six-second
deadline. Process RSS includes all fixtures/module loads/GC and does not establish
a memory improvement or a hard memory limit.

The separate 20-case pool suite exercises default capacity, tracked/uncached FIFO,
both modes, queue overload/retry, consumer cancellation, ignored aborts, late results
and rejections, unchanged deadlines and exact-once release after loader/projection
errors. First RED: 87 PASS / 16 FAIL across the full selection. Final default-32
GREEN: **103/103 in eight files**, 4.38 s, including provider-body and package tests:
`outputs/public-catalog-cache/2026-10-01T14-46-01-452Z-20044.log`.

## Outstanding scaling limits exposed by the test

The 64-job cache limit still bounds **tracked deduplication**, while the new pool
also bounds actual loads per process. Disjoint warm batches still need 592 further
provider calls. Real-provider latency, multi-replica behavior and trusted ingress
admission are unmeasured. A permanently uncooperative loader can retain a slot;
releasing it before settlement would invalidate the capacity protection.

Every call still reads all placements, even for a nine-card page. Authorization and
revocation checks deliberately remain per request. Safe indexed pagination needs to
preserve the existing global collision/layout invariant; caching private snapshots
without a revision/invalidation contract is not an acceptable shortcut. Public
read-limit ingress prerequisites remain in `docs/RELEASE_27_PUBLIC_READ_LIMITS.md`.
