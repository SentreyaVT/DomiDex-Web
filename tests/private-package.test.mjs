import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('imports all private backend operations from a clean package without relying on stale dist files', () => {
  const root = process.cwd();
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'domidex-private-package-test-'));
  const resolved = path.resolve(isolated);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('domidex-private-package-test-')) throw Error('UNSAFE_TEMP_CLEANUP');
  try {
    for (const folder of ['backend/security', 'backend/scan-knowledge', 'lib']) {
      fs.cpSync(path.join(root, folder), path.join(isolated, folder), {
        recursive: true, filter: source => !source.split(path.sep).some(part => part === 'node_modules' || part.startsWith('.env')),
      });
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(isolated, 'node_modules'), 'junction');
    const env = { NODE_ENV: 'test' };
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
    const isolatedHome = path.join(isolated, 'empty-home'); fs.mkdirSync(isolatedHome);
    Object.assign(env, { HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: isolatedHome, LOCALAPPDATA: isolatedHome });
    const packaged = pathToFileURL(path.join(isolated, 'dist/standalone/backend/security/routes.mjs')).href;
    const source = `import net from 'node:net'; import tls from 'node:tls';
      const blocked=()=>{throw Error('PACKAGE_SMOKE_NETWORK_DISABLED')};
      globalThis.fetch=blocked; net.Socket.prototype.connect=blocked; tls.connect=blocked;
      await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/package-private-operations.mjs')).href)});
      const operations=await import(${JSON.stringify(packaged)});
      for(const key of ['uploadReport','createBinderShare','revokeBinderShare','changeRole','deletionRequest'])
        if(typeof operations[key]!=='function') throw Error('PACKAGED_OPERATION_MISSING');
      console.log('CLEAN_PACKAGE_IMPORT_OK');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { cwd: isolated, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('CLEAN_PACKAGE_IMPORT_OK');
    expect(fs.existsSync(path.join(isolated, 'dist/standalone/backend/security/rate-limit.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(isolated, 'dist/standalone/backend/security/app-check.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(isolated, 'dist/standalone/backend/security/cardmarket-identity.mjs'))).toBe(true);
  } finally {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}, 30000);
