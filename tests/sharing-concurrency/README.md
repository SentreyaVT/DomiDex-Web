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

## Root verification, 2026-10-01

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

## Outstanding scaling limits exposed by the test

The 64-job cache limit bounds **tracked deduplication**, not total upstream requests.
Overflow performs uncached work: 80 disjoint readers reached 480 simultaneous fake
provider calls and needed 592 further calls in a warm batch. Do not present this as
a global limiter. A future queue/overload policy needs separate cancellation,
fairness, latency and real-provider validation before changing runtime behavior.

Every call still reads all placements, even for a nine-card page. Authorization and
revocation checks deliberately remain per request. Safe indexed pagination needs to
preserve the existing global collision/layout invariant; caching private snapshots
without a revision/invalidation contract is not an acceptable shortcut. Public
read-limit ingress prerequisites remain in `docs/RELEASE_27_PUBLIC_READ_LIMITS.md`.
