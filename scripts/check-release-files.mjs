import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.includes('--staged') ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files', '--modified', '--others', '--exclude-standard'];
const files = execFileSync('git', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{0,100}MII/,
  /ghp_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /ya29\.[A-Za-z0-9_-]{40,}/,
  /"signerKey"\s*:\s*"[^"]{20,}"/,
];
const findings = files.filter((file) => fs.existsSync(file) && fs.statSync(file).isFile()).filter((file) =>
  /(^|\/)\.env(?!\.example$)/.test(file) || /(^|\/)(\.domidex|node_modules)\//.test(file) || patterns.some((pattern) => pattern.test(fs.readFileSync(file, 'utf8'))));
console.log(JSON.stringify({ checked: files.length, credentialFindings: findings }));
if (findings.length) process.exitCode = 1;
