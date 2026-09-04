import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { accessToken, cloudCall, projectId } from './privacy-live-context.mjs';

const stateFile = '.domidex/security-gate/temporary-signing-permission.json';
const serviceAccount = '361496003351-compute@developer.gserviceaccount.com';
const accountUrl = `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${serviceAccount}`;
const token = accessToken();
const call = async (url, method, body) => (await cloudCall(token, url, { method, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
const getPolicy = () => call(`${accountUrl}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } });

try {
  if (process.argv.includes('--grant')) {
    if (fs.existsSync(stateFile)) throw new Error('EXISTING_TEST_PERMISSION_REVIEW_REQUIRED');
    const account = execFileSync('pwsh.exe', ['-NoProfile', '-Command', '& gcloud config get-value account'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(account)) throw new Error('UNEXPECTED_ACTIVE_ACCOUNT');
    const roleId = `domidexPrivacySignBlob${Date.now()}`;
    const role = await call(`https://iam.googleapis.com/v1/projects/${projectId}/roles`, 'POST', { roleId, role: { title: 'Temporary DomiDex privacy verification', description: 'One-hour isolated-account security test; remove after verification.', includedPermissions: ['iam.serviceAccounts.signBlob'], stage: 'GA' } });
    const expiry = new Date(Date.now() + 60 * 60_000).toISOString();
    const binding = { role: role.name, members: [`user:${account}`], condition: { title: roleId, expression: `request.time < timestamp('${expiry}')` } };
    fs.writeFileSync(stateFile, JSON.stringify({ role: role.name, binding, expiry, granted: false }, null, 2));
    const policy = await getPolicy();
    await call(`${accountUrl}:setIamPolicy`, 'POST', { policy: { ...policy, version: 3, bindings: [...(policy.bindings || []), binding] } });
    fs.writeFileSync(stateFile, JSON.stringify({ role: role.name, binding, expiry, granted: true }, null, 2));
    console.log(JSON.stringify({ granted: true, onlyPermission: 'iam.serviceAccounts.signBlob', expiresAt: expiry }));
  } else if (process.argv.includes('--revoke')) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const policy = await getPolicy();
    const retained = (policy.bindings || []).filter((binding) => !(binding.role === state.role && binding.condition?.title === state.binding.condition.title));
    if (retained.length !== (policy.bindings || []).length) await call(`${accountUrl}:setIamPolicy`, 'POST', { policy: { ...policy, bindings: retained } });
    const response = await cloudCall(token, `https://iam.googleapis.com/v1/${state.role}`, { method: 'DELETE' });
    await response.text();
    const verified = await getPolicy();
    if (verified.bindings?.some((binding) => binding.role === state.role)) throw new Error('REMOVAL_NOT_CONFIRMED');
    fs.renameSync(stateFile, stateFile.replace('.json', '.removed.json'));
    console.log(JSON.stringify({ temporaryPermissionRemoved: true }));
  } else console.log(JSON.stringify({ pending: fs.existsSync(stateFile) }));
} catch (error) { console.error(JSON.stringify({ error: error.message?.startsWith('CLOUD_HTTP_') ? error.message : 'PERMISSION_OPERATION_FAILED' })); process.exitCode = 1; }
