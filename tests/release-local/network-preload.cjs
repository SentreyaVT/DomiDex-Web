/* oxlint-disable typescript/no-require-imports -- Node --require preload must run synchronously before ESM imports. */
// Defense in depth for trusted local tests, not an OS sandbox. Loaded in Node workers too.
const blocked = () => { throw Error('RELEASE_LOCAL_NETWORK_DISABLED'); };
globalThis.fetch = blocked;
globalThis.WebSocket = blocked;
require('node:net').Socket.prototype.connect = blocked;
require('node:tls').connect = blocked;
require('node:http2').connect = blocked;
require('node:dgram').createSocket = blocked;
const dns = require('node:dns');
for (const name of Object.keys(dns)) {
  if (/^(lookup|resolve|reverse)/.test(name) && typeof dns[name] === 'function') dns[name] = blocked;
  if (/^(lookup|resolve|reverse)/.test(name) && typeof dns.promises[name] === 'function') dns.promises[name] = blocked;
}
const cp = require('node:child_process');
const path = require('node:path');
for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = cp[method];
  cp[method] = function(file, ...args) {
    if (!['node', 'node.exe', 'esbuild', 'esbuild.exe'].includes(path.basename(String(file)).toLowerCase())) {
      throw Error('RELEASE_LOCAL_CHILD_DISABLED');
    }
    return original.call(this, file, ...args);
  };
}
cp.exec = (command, ...args) => {
  // Vite's optional Windows drive probe must not spawn a shell or query mapped shares.
  if (command === 'net use' && typeof args.at(-1) === 'function') {
    queueMicrotask(() => args.at(-1)(Error('RELEASE_LOCAL_DRIVE_PROBE_DISABLED'), '', ''));
    return new (require('node:events').EventEmitter)();
  }
  return blocked();
};
cp.execSync = blocked;
require('node:module').syncBuiltinESMExports();
