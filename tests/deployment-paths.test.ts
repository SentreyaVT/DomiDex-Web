import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
type Copy = { from?: string; sources: string[]; destination: string; workdir: string };
type Stage = { workdir: string; copies: Copy[]; buildWorkdirs: string[] };

// Read the real Docker stages, including inherited WORKDIR. Deliberately reject
// variable/quoted/continued forms rather than guessing a different Docker layout.
function dockerStages(text: string): Map<string, Stage> {
  const stages = new Map<string, Stage>();
  let current: Stage | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.endsWith('\\')) throw Error('Review multiline Docker instructions explicitly');
    const from = /^FROM (\S+) AS ([a-z][a-z0-9-]*)$/i.exec(line);
    if (from) {
      if (stages.has(from[2])) throw Error('Duplicate Docker stage');
      current = { workdir: stages.get(from[1])?.workdir ?? '/', copies: [], buildWorkdirs: [] };
      stages.set(from[2], current);
      continue;
    }
    if (!current) throw Error('Instruction before named Docker stage');
    const workdir = /^WORKDIR (\S+)$/.exec(line);
    if (workdir) {
      if (!/^[a-zA-Z0-9_./-]+$/.test(workdir[1])) throw Error('Unresolved Docker WORKDIR');
      current.workdir = path.posix.resolve(current.workdir, workdir[1]);
    } else if (line.startsWith('COPY ')) {
      const tokens = line.slice(5).split(/\s+/);
      if (tokens.some((token) => /["'$[\]]/.test(token))) throw Error('Review nonliteral COPY explicitly');
      const flags = tokens.filter((token) => token.startsWith('--'));
      if (flags.some((flag) => !/^--(?:from|chown)=\S+$/.test(flag))) throw Error('Unreviewed COPY flag');
      const files = tokens.filter((token) => !token.startsWith('--'));
      if (files.length < 2) throw Error('Invalid COPY');
      current.copies.push({ from: flags.find((flag) => flag.startsWith('--from='))?.slice(7),
        sources: files.slice(0, -1), destination: files.at(-1)!, workdir: current.workdir });
    } else if (/^RUN\s+.*\bnpm run build(?:\s|$)/.test(line)) {
      current.buildWorkdirs.push(current.workdir);
    }
  }
  return stages;
}

function appFiles(directory = 'app'): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw Error('App source symlink requires explicit review');
    const relative = `${directory}/${entry.name}`;
    return entry.isDirectory() ? appFiles(relative) : entry.isFile() ? [relative] : [];
  }).sort();
}

function rootRelativeShadows(workdir: string, files: string[]) {
  return files.flatMap((source) => {
    const absoluteImport = path.posix.join(workdir, source);
    // Vinext emits absolute file imports without /@fs/. Vite8 passes asSrc/root
    // to its native Rolldown resolver: a leading slash can be project-relative.
    // This tests the actual candidate-file collision, not a mocked Vite bundle.
    const rootRelativeCandidate = path.posix.resolve(workdir, absoluteImport.slice(1));
    const shadow = path.posix.relative(workdir, rootRelativeCandidate);
    const local = path.join(root, ...shadow.split('/'));
    return rootRelativeCandidate !== absoluteImport && existsSync(local) && lstatSync(local).isFile()
      ? [{ source, absoluteImport, shadow, rootRelativeCandidate }] : [];
  });
}

describe('Docker deployment source paths', () => {
  it('has no existing root-relative file shadowing an absolute app import at the real builder WORKDIR', () => {
    const stages = dockerStages(readFileSync(path.join(root, 'Dockerfile'), 'utf8'));
    const builder = stages.get('builder');
    expect(builder, 'Named production builder stage').toBeDefined();
    expect(builder!.buildWorkdirs).toHaveLength(1);
    const workdir = builder!.buildWorkdirs[0];
    expect(builder!.copies.filter((copy) => !copy.from && copy.sources.join(' ') === '.' &&
      path.posix.resolve(copy.workdir, copy.destination) === workdir), 'Real source tree copied to build root').toHaveLength(1);
    expect(rootRelativeShadows(workdir, appFiles()),
      `Docker builder ${workdir}: absolute imports must not resolve to another existing source file`).toEqual([]);
  });

  it('retains the actual root/nested route collision as a counterfactual control', () => {
    const files = appFiles();
    expect(files).toEqual(expect.arrayContaining(['app/layout.tsx', 'app/page.tsx', 'app/app/layout.tsx', 'app/app/page.tsx']));
    const shadows = rootRelativeShadows('/app', files);
    expect(shadows).toEqual(expect.arrayContaining([
      { source: 'app/layout.tsx', absoluteImport: '/app/app/layout.tsx', shadow: 'app/app/layout.tsx', rootRelativeCandidate: '/app/app/app/layout.tsx' },
      { source: 'app/page.tsx', absoluteImport: '/app/app/page.tsx', shadow: 'app/app/page.tsx', rootRelativeCandidate: '/app/app/app/page.tsx' },
    ]));
  });

  it('keeps the runtime at /app and copies the actual builder outputs without stale /app source paths', () => {
    const stages = dockerStages(readFileSync(path.join(root, 'Dockerfile'), 'utf8'));
    const builder = stages.get('builder')!;
    const runtime = stages.get('runtime')!;
    expect(builder.buildWorkdirs).toHaveLength(1);
    expect(runtime.workdir).toBe('/app');
    const built = runtime.copies.filter((copy) => copy.from === 'builder');
    expect(built).toHaveLength(2);
    expect(built.map((copy) => ({ sources: copy.sources,
      destination: path.posix.resolve(copy.workdir, copy.destination) }))).toEqual([
      { sources: [path.posix.join(builder.buildWorkdirs[0], 'dist/standalone')], destination: '/app' },
      { sources: [path.posix.join(builder.buildWorkdirs[0], '.env.production.local')], destination: '/app/.env.production.local' },
    ]);
  });
});
