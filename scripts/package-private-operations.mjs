import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const sourceDirectory = path.join(root, 'backend', 'security');
const outputDirectory = path.join(root, 'dist', 'standalone', 'backend', 'security');
const knowledgeOutputDirectory = path.join(root, 'dist', 'standalone', 'backend', 'scan-knowledge');
const files = ['package.json', 'firebase.mjs', 'images.mjs', 'deletion.mjs', 'routes.mjs', 'access.mjs', 'sharing.mjs', 'reviewed-knowledge.mjs', 'rate-limit.mjs'];

await mkdir(outputDirectory, { recursive: true });
for (const file of files) {
  let source = await readFile(path.join(sourceDirectory, file), 'utf8');
  if (file === 'images.mjs') source = source.replace("'../../lib/scanner-report.ts'", "'./scanner-report.mjs'");
  if (file === 'sharing.mjs') source = source.replace("'../../lib/shared-binder.ts'", "'./shared-binder.mjs'");
  source = source.replace("'../../lib/bounded-json.ts'", "'./bounded-json.mjs'");
  source = source.replace("'../../lib/scanner-feedback.ts'", "'./scanner-feedback.mjs'");
  await writeFile(path.join(outputDirectory, file), source, 'utf8');
}

const scannerReport = ts.transpileModule(await readFile(path.join(root, 'lib', 'scanner-report.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace("from './scanner-feedback'", "from './scanner-feedback.mjs'");
await writeFile(path.join(outputDirectory, 'scanner-report.mjs'), scannerReport, 'utf8');
for (const file of ['domain', 'cardmarket-identity', 'shared-binder', 'bounded-json', 'scanner-feedback']) {
  const source = ts.transpileModule(await readFile(path.join(root, 'lib', `${file}.ts`), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from '\.\/(domain|cardmarket-identity)'/g, "from './$1.mjs'");
  await writeFile(path.join(outputDirectory, `${file}.mjs`), source, 'utf8');
}
await mkdir(knowledgeOutputDirectory, { recursive: true });
await writeFile(
  path.join(knowledgeOutputDirectory, 'knowledge-aggregate.js'),
  await readFile(path.join(root, 'backend', 'scan-knowledge', 'knowledge-aggregate.js'), 'utf8'),
  'utf8',
);
await writeFile(
  path.join(knowledgeOutputDirectory, 'package.json'),
  JSON.stringify({ type: 'module', private: true }, null, 2),
  'utf8',
);

const packagedKnowledge = await import(pathToFileURL(path.join(knowledgeOutputDirectory, 'knowledge-aggregate.js')).href);
if (typeof packagedKnowledge.aggregateVote !== 'function') throw new Error('PACKAGED_KNOWLEDGE_AGGREGATE_INVALID');

console.log(`Packaged private Cloud Run operations in ${path.relative(root, outputDirectory)}.`);
