import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { execFileSync, execSync } from 'node:child_process';

await test('preload blocks fetch and socket transports before any connection starts', () => {
  for (const operation of [() => fetch('https://synthetic.invalid'),
    () => net.connect(9, '127.0.0.1'), () => tls.connect(9, '127.0.0.1'),
    () => dgram.createSocket('udp4'), () => dns.lookup('synthetic.invalid', () => {}),
    () => dns.promises.resolveMx('synthetic.invalid')]) {
    assert.throws(operation, /RELEASE_LOCAL_NETWORK_DISABLED/);
  }
});
await test('preload blocks external helpers and shell execution', () => {
  assert.throws(() => execFileSync('curl', ['https://synthetic.invalid']), /RELEASE_LOCAL_CHILD_DISABLED/);
  assert.throws(() => execSync('echo forbidden'), /RELEASE_LOCAL_NETWORK_DISABLED/);
});
