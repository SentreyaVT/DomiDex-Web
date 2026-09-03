import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile('.env.local', 'utf8');
const values = new Map();
for (const line of source.split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match) values.set(match[1], match[2]);
}

const required = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];
for (const key of required) {
  if (!values.get(key)?.trim()) throw new Error(`${key} fehlt in .env.local.`);
}

const optional = [
  'NEXT_PUBLIC_DISCORD_URL',
  'NEXT_PUBLIC_GITHUB_URL',
  'NEXT_PUBLIC_KICKSTARTER_URL',
];
const output = [
  ...required.map((key) => `${key}=${values.get(key)}`),
  ...optional.filter((key) => values.has(key)).map((key) => `${key}=${values.get(key)}`),
  'NEXT_PUBLIC_SITE_URL=https://domidex.web.app',
  '',
].join('\n');

await writeFile('.env.production.local', output, { encoding: 'utf8', mode: 0o600 });
console.log('Sanitized Firebase build environment prepared.');
