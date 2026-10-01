import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

export const PROJECT = 'demo-domidex-privacy';
export const PORTS = Object.freeze({ auth: 9097, firestore: 8187, storage: 9297, hub: 4407, logging: 4507, websocket: 9150 });
export const REVIEWED_CLI = '15.28.2';
const REVIEWED_JARS = Object.freeze({ firestore: '1.22.0', storage: '1.1.3' });

export function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['--firebase-cli', '--java-home', '--emulator-cache'].includes(name) || !args[index + 1] || result[name]) {
      throw Error('Use only --firebase-cli PATH, --java-home PATH and --emulator-cache PATH, once each.');
    }
    result[name] = path.resolve(args[index + 1]);
  }
  return result;
}

export function requireFile(file) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) throw Error('Required preinstalled file missing; no download is allowed.');
  return path.resolve(file);
}

export function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function validateMetadata(cliVersion, metadata) {
  if (cliVersion !== REVIEWED_CLI) throw Error('Unreviewed Firebase CLI version; update and review the harness before running.');
  return Object.entries(REVIEWED_JARS).map(([service, version]) => {
    const entry = metadata[service];
    if (entry?.version !== version || !Number.isSafeInteger(entry.expectedSize) || entry.expectedSize <= 0 ||
        !/^[a-f0-9]{64}$/i.test(entry.expectedChecksumSHA256 ?? '') ||
        typeof entry.downloadPathRelativeToCacheDir !== 'string' ||
        !/^[a-z0-9.-]+\.jar$/.test(entry.downloadPathRelativeToCacheDir)) {
      throw Error(`Missing or unreviewed emulator integrity metadata: ${service}`);
    }
    return { service, version, file: entry.downloadPathRelativeToCacheDir, bytes: entry.expectedSize,
      sha256: entry.expectedChecksumSHA256.toLowerCase() };
  });
}

export async function verifyCache(cache, entries) {
  for (const entry of entries) {
    const file = requireFile(path.join(cache, entry.file));
    if (statSync(file).size !== entry.bytes || await sha256(file) !== entry.sha256) {
      throw Error(`Cached emulator integrity mismatch: ${entry.service}; no download or replacement performed.`);
    }
  }
}

export function firebaseConfiguration() {
  const services = Object.fromEntries(['auth', 'firestore', 'storage', 'hub', 'logging']
    .map((service) => [service, { host: '127.0.0.1', port: PORTS[service] }]));
  services.firestore.websocketPort = PORTS.websocket;
  return { firestore: { rules: 'firestore.rules' }, storage: { rules: 'storage.rules' },
    emulators: { ...services, ui: { enabled: false }, singleProjectMode: true } };
}

export async function assertPortsFree(ports = Object.values(PORTS)) {
  // Bind (not connect) on both loopback families, also catching wildcard listeners.
  // We do not keep the ports reserved: a competing process can still race startup.
  for (const port of ports) {
    for (const host of ['127.0.0.1', '::1']) {
      await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', (error) => {
          if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) resolve();
          else reject(Error(`Port ${port} unavailable on loopback (${error.code}); no process was terminated.`));
        });
        server.listen({ host, port, exclusive: true, ipv6Only: host === '::1' }, () => server.close(resolve));
      });
    }
  }
}

export function isolatedEnvironment(source, { directory, root, java, cache, preload, node = process.execPath }) {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) {
    if (source[key]) env[key] = source[key];
  }
  const systemDirectory = source.SystemRoot ? path.join(source.SystemRoot, 'System32') : undefined;
  env.PATH = [path.dirname(node), path.dirname(java), ...(systemDirectory ? [systemDirectory] : ['/usr/bin', '/bin'])].join(path.delimiter);
  if (systemDirectory) env.COMSPEC = path.join(systemDirectory, 'cmd.exe');
  env.TEMP = env.TMP = path.join(directory, 'temp');
  env.HOME = env.USERPROFILE = path.join(directory, 'home');
  env.APPDATA = path.join(directory, 'appdata');
  env.LOCALAPPDATA = path.join(directory, 'localappdata');
  env.XDG_CONFIG_HOME = path.join(directory, 'xdg');
  env.CLOUDSDK_CONFIG = path.join(directory, 'cloudsdk');
  env.JAVA_HOME = path.dirname(path.dirname(java));
  env.FIREBASE_EMULATORS_PATH = cache;
  env.GCLOUD_PROJECT = env.GOOGLE_CLOUD_PROJECT = PROJECT;
  env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${PORTS.firestore}`;
  env.FIREBASE_STORAGE_EMULATOR_HOST = `127.0.0.1:${PORTS.storage}`;
  env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${PORTS.auth}`;
  env.NO_PROXY = 'localhost,127.0.0.1,::1';
  env.NODE_USE_ENV_PROXY = '0';
  env.CI = 'true';
  env.NO_UPDATE_NOTIFIER = '1';
  env.FIREBASE_CLI_DISABLE_TELEMETRY = 'true';
  env.NODE_OPTIONS = `--require=${JSON.stringify(preload.replaceAll('\\', '/'))}`;
  env.DOMIDEX_PRIVATE_TEST_ROOT = root;
  env.DOMIDEX_PRIVATE_TEST_RUN = directory;
  return env;
}

export function assertTestEnvironment(env) {
  if (env.GCLOUD_PROJECT !== PROJECT || env.GOOGLE_CLOUD_PROJECT !== PROJECT ||
      env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${PORTS.firestore}` ||
      env.FIREBASE_STORAGE_EMULATOR_HOST !== `127.0.0.1:${PORTS.storage}` ||
      env.FIREBASE_AUTH_EMULATOR_HOST !== `127.0.0.1:${PORTS.auth}`) throw Error('Exact local demo environment required.');
  for (const key of Object.keys(env)) {
    if (/credential|secret|token|private.?key|^firebase_config$|^java_tool_options$|^jdk_java_options$|^_java_options$/i.test(key) ||
        (/proxy/i.test(key) && !['NO_PROXY', 'NODE_USE_ENV_PROXY'].includes(key))) throw Error('Unsafe environment key; refusing run.');
  }
}

export function runChild(command, args, { cwd, env, timeoutMs, onOutput = () => {} }) {
  return new Promise((resolve) => {
    let stopped = null;
    let settled = false;
    let bytes = 0;
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    function stop(reason) {
      if (settled || stopped) return;
      stopped = reason;
      // Only our still-running, directly spawned PID/tree; never kill by port/name.
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          const termination = spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, shell: false, stdio: 'ignore', timeout: 10_000 });
          if (termination.status !== 0) child.kill('SIGKILL');
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
        }
      }
    }
    const interrupt = () => stop('interrupted');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    function complete(code, signal, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      resolve({ code: stopped || error || signal ? 1 : code ?? 1, signal, stopped, error: error?.code ?? null });
    }
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) stop('output-limit');
      else {
        try { onOutput(chunk); }
        catch { stop('output-handler-failed'); }
      }
    });
    child.once('error', (error) => complete(1, null, error));
    child.once('close', (code, signal) => complete(code, signal));
  });
}

export function readJson(file) { return JSON.parse(readFileSync(requireFile(file), 'utf8')); }
