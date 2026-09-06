import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const sourceDirectory = path.join(root, 'backend', 'security');
const outputDirectory = path.join(root, 'dist', 'standalone', 'backend', 'security');
const knowledgeOutputDirectory = path.join(root, 'dist', 'standalone', 'backend', 'scan-knowledge');
const files = ['package.json', 'firebase.mjs', 'images.mjs', 'deletion.mjs', 'routes.mjs'];

await mkdir(outputDirectory, { recursive: true });
for (const file of files) {
  let source = await readFile(path.join(sourceDirectory, file), 'utf8');
  if (file === 'images.mjs') source = source.replace("'../../lib/scanner-report.ts'", "'./scanner-report.mjs'");
  await writeFile(path.join(outputDirectory, file), source, 'utf8');
}

const scannerReport = ts.transpileModule(await readFile(path.join(root, 'lib', 'scanner-report.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
await writeFile(path.join(outputDirectory, 'scanner-report.mjs'), scannerReport, 'utf8');
await mkdir(knowledgeOutputDirectory, { recursive: true });
await writeFile(
  path.join(knowledgeOutputDirectory, 'knowledge-aggregate.js'),
  await readFile(path.join(root, 'backend', 'scan-knowledge', 'knowledge-aggregate.js'), 'utf8'),
  'utf8',
);
await writeFile(
  path.join(knowledgeOutputDirectory, 'package.json'),
  JSON.stringify({ type: 'commonjs', private: true }, null, 2),
  'utf8',
);

const require = createRequire(import.meta.url);
const packagedKnowledge = require(path.join(knowledgeOutputDirectory, 'knowledge-aggregate.js'));
if (typeof packagedKnowledge.aggregateVote !== 'function') throw new Error('PACKAGED_KNOWLEDGE_AGGREGATE_INVALID');

console.log(`Packaged private Cloud Run operations in ${path.relative(root, outputDirectory)}.`);
