'use strict';
/* oxlint-disable typescript/no-require-imports -- NODE_OPTIONS --require preloads CommonJS before ESM/SDK initialization. */
// Defense in depth for Node CLI/SDKs, loaded before their imports. This does NOT
// instrument Java, native addons or the OS; it is not a security sandbox.
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const dgram = require('node:dgram');
const http2 = require('node:http2');
const allowed = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function blocked() {
  const error = new Error('PRIVATE_TEST_NONLOCAL_NETWORK_BLOCKED');
  error.code = 'PRIVATE_TEST_NONLOCAL_NETWORK_BLOCKED';
  throw error;
}
function check(host) { if (!allowed.has(String(host || 'localhost').toLowerCase())) blocked(); }
function checkConnection(options) {
  if (options.path) {
    // Windows UNC pipes may otherwise contact a remote SMB server.
    if (process.platform === 'win32' && !String(options.path).startsWith('\\\\.\\pipe\\')) blocked();
  } else check(options.host);
}
function checkUrl(value) {
  const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) blocked();
  check(url.hostname);
}
// Deliberately retain the original method; each wrapper forwards its receiver.
// oxlint-disable-next-line typescript/unbound-method
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // net.connect() passes an already normalized [options, callback] array into
  // Socket.connect(). Normalizing that array again would hide options.host.
  const options = Array.isArray(args[0]) ? args[0][0] : net._normalizeArgs(args)[0];
  checkConnection(options); // Local IPC is allowed for subprocesses.
  return connect.apply(this, args);
};
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : net._normalizeArgs(args)[0];
  checkConnection(options);
  return tlsConnect.apply(this, args);
};
for (const api of [dns, dns.promises]) {
  for (const method of Object.keys(api).filter((name) => name === 'lookup' || name === 'lookupService' || name === 'reverse' || name.startsWith('resolve'))) {
    if (typeof api[method] !== 'function') continue;
    const original = api[method];
    api[method] = function (host, ...args) { check(host); return original.call(this, host, ...args); };
  }
}
dgram.createSocket = blocked;
const http2Connect = http2.connect;
http2.connect = function (authority, ...args) { checkUrl(authority); return http2Connect.call(this, authority, ...args); };
if (globalThis.fetch) {
  const fetch = globalThis.fetch;
  globalThis.fetch = function (input, ...args) { checkUrl(input); return fetch.call(this, input, ...args); };
}
if (globalThis.WebSocket) {
  const WebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class LocalWebSocket extends WebSocket {
    constructor(url, ...args) { checkUrl(url); super(url, ...args); }
  };
}
require('node:module').syncBuiltinESMExports();
