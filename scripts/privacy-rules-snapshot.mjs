import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { accessToken, cloudCall, projectId, bucket } from './privacy-live-context.mjs';
const token = accessToken();
const mode = process.argv.includes('--verify') ? 'after' : 'before';
const results = {};
for (const [name, release] of [['firestore', 'cloud.firestore'], ['storage', `firebase.storage/${bucket}`]]) {
  const current = await (await cloudCall(token, `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${release}`)).json();
  const ruleset = await (await cloudCall(token, `https://firebaserules.googleapis.com/v1/${current.rulesetName}`)).json();
  const content = ruleset.source.files.find((file) => file.name.endsWith('.rules')).content;
  fs.writeFileSync(`.domidex/security-gate/${name}-${mode}.rules`, content);
  const local = fs.readFileSync(`${name}.rules`, 'utf8');
  const normalize = (value) => value.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').trim();
  results[name] = { ruleset: current.rulesetName, identical: normalize(content) === normalize(local), sha256: createHash('sha256').update(normalize(content)).digest('hex') };
}
fs.writeFileSync(`.domidex/security-gate/rules-${mode}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
if (mode === 'after' && Object.values(results).some((result) => !result.identical)) process.exitCode = 1;
