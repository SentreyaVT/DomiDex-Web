# Official Discord invite — 2026-09-23

Published the operator-confirmed permanent invite `https://discord.gg/fc9XgwtVTE`
to the existing public website and web app. It replaces the previous
`https://discord.gg/a6DfqBt8N7` invite.

- Hosting version: `5e5efe92cf3b7e97`; previous: `4704f6013ed900e1`.
- Pinned revision: `domidex-web-discord-invite-20260923`.
- Image digest: `sha256:011b9985e3259dededd7b45a75fbbaa0c3df5d9f9882610c96ec178dd08e23a0`.
- Cloud Build: `02756504-7ad5-4af3-a3e6-67b55ff57094`, europe-west1, SUCCESS.

The release layers the exact previous live image. Only three compiled invite
strings changed; dependent client asset filenames and their import references
were refreshed to avoid immutable browser/Hosting caches. All previous hashed
assets remain available. The exact live contact HTML received one href
replacement; 154 of 155 Hosting file hashes remain unchanged. The existing
legal-page rewrites and all other Hosting configuration were preserved, with
only the catchall runtime tag updated.

The `siteContent/public` document does not exist, so the website uses the
compiled fallback. No Firestore document was created or changed. No account,
security, rules, sharing, collection data, environment, IAM or Android changes
were deployed. Unrelated local changes were not rebuilt or released.

Source alignment: `lib/legal-content.ts`, `.env.local` and
`.env.production.local` use the new invite. Historical release evidence keeps
the old URL as a record of what was verified then.

Verification: 36 focused source tests and the legal-route consistency check
passed. The isolated candidate passed 35 checks, and live production passed
42 checks, covering exact public-response substitutions, all 23 refreshed
client assets, the site-content fallback, contact-page links and blocked
unauthenticated protected endpoints. `/app` remains byte-identical.

Guarded preparation, activation, immutable baselines and verification evidence
are retained in ignored `.domidex/discord-invite-20260923/`. No Git commit or
push was made. The previous Hosting version and Cloud Run revision remain
available for recovery.
