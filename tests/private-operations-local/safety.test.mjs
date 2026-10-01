import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { PROJECT, PORTS, REVIEWED_CLI, parseOptions, validateMetadata, verifyCache, sha256,
  firebaseConfiguration, assertPortsFree, isolatedEnvironment, assertTestEnvironment, runChild } from './safety.mjs';

const preload = fileURLToPath(new URL('./network-preload.cjs', import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'domidex-private-safety-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function environment(directory) {
  return isolatedEnvironment(process.env, { directory, root: directory, java: process.execPath,
    cache: directory, preload });
}
function metadata() {
  return { firestore: { version: '1.22.0', expectedSize: 1, expectedChecksumSHA256: 'a'.repeat(64), downloadPathRelativeToCacheDir: 'firestore.jar' },
    storage: { version: '1.1.3', expectedSize: 1, expectedChecksumSHA256: 'b'.repeat(64), downloadPathRelativeToCacheDir: 'storage.jar' } };
}

void test('arguments never accept project overrides, unknown keys, duplicates or missing values', () => {
  assert.deepEqual(parseOptions([]), {});
  assert.equal(parseOptions(['--java-home', '.'])['--java-home'], path.resolve('.'));
  for (const args of [['--project', 'production'], ['--java-home'], ['--java-home', '.', '--java-home', '.'], ['--download', 'yes']]) {
    assert.throws(() => parseOptions(args));
  }
});
void test('configuration binds every emulator to 127.0.0.1, disables UI and uses fixed ports', () => {
  const config = firebaseConfiguration();
  assert.equal(config.emulators.ui.enabled, false);
  for (const name of ['auth', 'firestore', 'storage', 'hub', 'logging']) {
    assert.equal(config.emulators[name].host, '127.0.0.1');
    assert.equal(config.emulators[name].port, PORTS[name]);
  }
  assert.equal(config.emulators.firestore.websocketPort, 9150);
  assert.equal(config.emulators.singleProjectMode, true);
});
void test('unknown CLI/emulator versions, missing hashes, unsafe names and invalid sizes fail closed', () => {
  assert.equal(validateMetadata(REVIEWED_CLI, metadata()).length, 2);
  assert.throws(() => validateMetadata('99.0.0', metadata()));
  for (const change of [{ version: 'future' }, { expectedChecksumSHA256: undefined }, { expectedChecksumSHA256: 'md5' },
    { expectedSize: 0 }, { expectedSize: 1.2 }, { downloadPathRelativeToCacheDir: '../outside.jar' }]) {
    const data = metadata(); Object.assign(data.firestore, change);
    assert.throws(() => validateMetadata(REVIEWED_CLI, data));
  }
});
void test('cache verification checks exact SHA256 and size, never recreates absent files', async (t) => {
  const directory = fixture(t);
  const file = path.join(directory, 'example.jar'); writeFileSync(file, 'cached fixture');
  const entry = { service: 'fixture', file: 'example.jar', bytes: 14, sha256: await sha256(file) };
  await verifyCache(directory, [entry]);
  await assert.rejects(verifyCache(directory, [{ ...entry, bytes: 13 }]));
  await assert.rejects(verifyCache(directory, [{ ...entry, sha256: '0'.repeat(64) }]));
  await assert.rejects(verifyCache(directory, [{ ...entry, file: 'missing.jar' }]));
});
void test('child environment discards credentials, proxies, startup flags and external config locations', (t) => {
  const directory = fixture(t);
  const env = isolatedEnvironment({ ...process.env, GOOGLE_APPLICATION_CREDENTIALS: 'DO_NOT_READ', FIREBASE_TOKEN: 'DO_NOT_READ',
    HTTP_PROXY: 'DO_NOT_CONNECT', HTTPS_PROXY: 'DO_NOT_CONNECT', ALL_PROXY: 'DO_NOT_CONNECT',
    NODE_OPTIONS: '--require=untrusted', JAVA_TOOL_OPTIONS: '-javaagent:untrusted', FIREBASE_CONFIG: 'production',
    CLOUDSDK_CONFIG: 'DO_NOT_READ', APPDATA: 'DO_NOT_READ', CUSTOM_API_KEY: 'DO_NOT_READ' },
  { directory, root: directory, java: process.execPath, cache: directory, preload });
  assertTestEnvironment(env);
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'JAVA_TOOL_OPTIONS', 'FIREBASE_CONFIG', 'CUSTOM_API_KEY']) assert.equal(env[key], undefined);
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'CLOUDSDK_CONFIG', 'HOME', 'USERPROFILE', 'TEMP']) {
    assert.ok(env[key].startsWith(directory + path.sep));
  }
  assert.equal(env.GCLOUD_PROJECT, PROJECT);
  assert.ok(env.NODE_OPTIONS.includes('network-preload.cjs'));
});
void test('test entry rejects missing/foreign emulator hosts and credential-bearing environments', (t) => {
  const env = environment(fixture(t));
  for (const change of [{ GCLOUD_PROJECT: 'production' }, { FIRESTORE_EMULATOR_HOST: 'example.invalid:8187' },
    { FIREBASE_AUTH_EMULATOR_HOST: '' }, { GOOGLE_APPLICATION_CREDENTIALS: 'bad' }, { HTTPS_PROXY: 'bad' }, { FIREBASE_CONFIG: '{}' }]) {
    assert.throws(() => assertTestEnvironment({ ...env, ...change }));
  }
});
void test('occupied local port causes failure without closing its owner', async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(assertPortsFree([server.address().port]), /no process was terminated/);
  assert.equal(server.listening, true);
});
void test('free loopback ports pass the probe', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  await assertPortsFree([port]);
});
void test('preload blocks external fetch/socket/TLS/DNS/HTTP2/UDP before transport and allows real loopback', (t) => {
  const directory = fixture(t);
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const net = require('node:net');
    const blocked = /PRIVATE_TEST_NONLOCAL_NETWORK_BLOCKED/;
    for (const action of [
      () => fetch('https://example.invalid'),
      () => net.connect(443, 'example.invalid'),
      () => new net.Socket().connect(443, 'example.invalid'),
      () => require('node:tls').connect(443, 'example.invalid'),
      () => require('node:dns').lookup('example.invalid', () => {}),
      () => require('node:dns').promises.resolveTxt('example.invalid'),
      () => require('node:http2').connect('https://example.invalid'),
      () => require('node:dgram').createSocket('udp4'),
      () => new WebSocket('wss://example.invalid'),
    ]) assert.throws(action, blocked, action.toString());
    const server = net.createServer(socket => socket.end('local'));
    server.listen(0, '127.0.0.1', () => {
      const socket = net.connect(server.address().port, '127.0.0.1');
      let text = ''; socket.on('data', data => text += data);
      socket.on('end', () => { assert.equal(text, 'local'); server.close(); });
    });
  `], { env: environment(directory), encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false });
  assert.equal(result.status, 0, result.stderr);
});
void test('runChild preserves nonzero crash status and missing executable failure', async (t) => {
  const directory = fixture(t); const env = environment(directory);
  const options = { cwd: directory, env, timeoutMs: 10_000 };
  assert.equal((await runChild(process.execPath, ['-e', 'process.exit(7)'], options)).code, 7);
  const missing = await runChild(path.join(directory, 'missing-executable'), [], options);
  assert.equal(missing.code, 1); assert.equal(missing.error, 'ENOENT');
});
void test('runChild timeout terminates only its own tree and returns failure', async (t) => {
  const directory = fixture(t); const env = environment(directory);
  mkdirSync(env.TEMP);
  const result = await runChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
    { cwd: directory, env, timeoutMs: 250 });
  assert.equal(result.code, 1); assert.equal(result.stopped, 'timeout');
});
void test('runChild handles an explicit abort and removes its signal listeners', async (t) => {
  const directory = fixture(t);
  const previous = process.listenerCount('SIGTERM');
  const pending = runChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
    { cwd: directory, env: environment(directory), timeoutMs: 10_000 });
  process.emit('SIGTERM');
  const result = await pending;
  assert.equal(result.code, 1); assert.equal(result.stopped, 'interrupted');
  assert.equal(process.listenerCount('SIGTERM'), previous);
});
void test('runChild logging failure terminates its child instead of orphaning it', async (t) => {
  const directory = fixture(t);
  const result = await runChild(process.execPath, ['-e', 'console.log("fixture"); setInterval(() => {}, 1000)'],
    { cwd: directory, env: environment(directory), timeoutMs: 10_000, onOutput: () => { throw Error('simulated disk failure'); } });
  assert.equal(result.code, 1); assert.equal(result.stopped, 'output-handler-failed');
});
