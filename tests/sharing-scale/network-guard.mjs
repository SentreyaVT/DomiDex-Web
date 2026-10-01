import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { afterAll, expect, vi } from 'vitest';

// Executed before importing readBinderShare or its Firebase Admin dependencies.
// Use the launcher, which also strips inherited credentials and NODE_OPTIONS.
if (process.env.DOMIDEX_SHARING_SCALE_ISOLATED !== '1') throw Error('USE_SHARING_SCALE_RUNNER');
const attempts = [];
const block = (surface) => () => {
  attempts.push(surface); // API name only, never URLs, tokens or request arguments.
  throw Error('SHARING_SCALE_NETWORK_DISABLED');
};
vi.stubGlobal('fetch', block('fetch'));
vi.stubGlobal('WebSocket', block('WebSocket'));
vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(block('net.Socket.connect'));
vi.spyOn(tls, 'connect').mockImplementation(block('tls.connect'));
for (const [name, module] of [['http', http], ['https', https]]) {
  for (const method of ['get', 'request']) vi.spyOn(module, method).mockImplementation(block(`${name}.${method}`));
}
vi.spyOn(http2, 'connect').mockImplementation(block('http2.connect'));
vi.spyOn(dgram, 'createSocket').mockImplementation(block('dgram.createSocket'));
for (const method of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
  'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
  if (typeof dns[method] === 'function') vi.spyOn(dns, method).mockImplementation(block(`dns.${method}`));
  if (typeof dns.promises[method] === 'function') vi.spyOn(dns.promises, method).mockImplementation(block(`dns.promises.${method}`));
}
globalThis[Symbol.for('domidex.sharing-scale-network-guard')] = { attempts, active: true };
afterAll(() => {
  expect(attempts, 'Even a caught network attempt must fail this offline harness').toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
