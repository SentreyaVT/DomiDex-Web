// Explicit unit-test groups only. Never execute or expand package-script shell text.
export const unitGroups = ['test', 'test:rate-limits', 'test:app-check', 'test:owner-snapshots'];
const extraFiles = [
  'tests/admin-body-limits.test.mjs',
  'tests/cardmarket-root-identity.test.ts',
  'tests/collection-prices-incremental.test.ts',
  'tests/tcgdex-cache-metadata.test.ts',
];

export function unitFiles(scripts) {
  const files = [...extraFiles];
  for (const name of unitGroups) {
    const command = scripts?.[name];
    const prefix = 'vitest run --config vitest.config.ts ';
    if (typeof command !== 'string' || !command.startsWith(prefix)) throw Error(`Unsupported unit group: ${name}`);
    const group = command.slice(prefix.length).split(/\s+/);
    if (!group.length || group.some((file) => !/^tests\/[a-z0-9.-]+\.test\.(?:mjs|tsx?)$/.test(file)
      || /rules|emulator/.test(file))) throw Error(`Unsafe unit selection: ${name}`);
    files.push(...group);
  }
  return [...new Set(files)].sort();
}

export function unitEnvironment(source, preloadPath) {
  const result = { NODE_ENV: 'test', CI: '1', NO_COLOR: '1', DOMIDEX_RELEASE_LOCAL: '1' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
    'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) if (source[key]) result[key] = source[key];
  if (/["\r\n]/.test(preloadPath)) throw Error('Unsupported preload path');
  result.NODE_OPTIONS = `--require="${preloadPath.replaceAll('\\', '/')}"`;
  return result;
}
