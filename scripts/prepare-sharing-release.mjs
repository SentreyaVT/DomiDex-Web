import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import ts from 'typescript';
import { patchSharingDeletion } from './sharing-deletion-compat.mjs';

const root = process.cwd();
const release = path.join(root, '.domidex/sharing-activation/release');
const backend = path.join(release, 'backend');
await fs.mkdir(backend, { recursive: true });
await build({ configFile: false, root: path.join(root, 'sharing-entry'), base: '/_binder-sharing-v1/', publicDir: false,
  plugins: [react()], resolve: { alias: { '@': root } },
  build: { outDir: path.join(release, 'public'), emptyOutDir: false, sourcemap: false },
});
for (const name of ['firebase', 'sharing']) {
  let source = await fs.readFile(path.join(root, 'backend/security', `${name}.mjs`), 'utf8');
  source = source.replace("'../../lib/shared-binder.ts'", "'./shared-binder.mjs'").replace("'../../lib/bounded-json.ts'", "'./bounded-json.mjs'");
  await fs.writeFile(path.join(backend, `${name}.mjs`), source);
}
for (const name of ['shared-binder', 'domain', 'cardmarket-identity', 'bounded-json']) {
  const source = ts.transpileModule(await fs.readFile(path.join(root, 'lib', `${name}.ts`), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from '\.\/(domain|cardmarket-identity)'/g, "from './$1.mjs'");
  await fs.writeFile(path.join(backend, `${name}.mjs`), source);
}
await fs.copyFile(path.join(root, 'backend/security/package.json'), path.join(backend, 'package.json'));
await fs.copyFile(path.join(root, 'scripts/sharing-runtime.mjs'), path.join(backend, 'runtime.mjs'));
await fs.copyFile(path.join(root, 'sharing-entry/assetlinks.json'), path.join(release, 'public/assetlinks.json'));
await fs.mkdir(path.join(release, 'public/materials'), { recursive: true });
for (const name of ['private_binder_cover_atlas.png', 'private_binder_holo_atlas.png', 'private_binder_element_holo_atlas.png']) {
  await fs.copyFile(path.join(root, 'public/binder-materials', name), path.join(release, 'public/materials', name));
}
const oldIndex = await fs.readFile(path.join(root, '.domidex/scanner-publication-20260903/runtime/app/dist/server/index.js'));
const expected = 'dedc55b812f3563ecf249b4335ad9481ab1f6bbd061cbcb83a71f5b75132ef77';
assert.equal(createHash('sha256').update(oldIndex).digest('hex'), expected);
const oldDeletion = await fs.readFile(path.join(root, '.domidex/security-gate/release/backend/security/deletion.mjs'), 'utf8');
const patchedDeletion = patchSharingDeletion(oldDeletion);
const deletionHash = createHash('sha256').update(oldDeletion).digest('hex');
await fs.writeFile(path.join(release, 'deletion-sharing-compat.mjs'), patchedDeletion);
await fs.writeFile(path.join(release, 'index.js'), `import original from './index-before-sharing.js';
export * from './index-before-sharing.js';
import { createSharingRouter } from '/app/backend/binder-sharing/runtime.mjs';
const operations=Object.fromEntries(['listBinderShares','createBinderShare','revokeBinderShare','readBinderShare'].map(name=>[name,async(...args)=>(await import('/app/backend/binder-sharing/sharing.mjs'))[name](...args)]));
const sharing = createSharingRouter({ operations, root:'/app/binder-sharing-public' });
export default { async fetch(request, env, context) { return (await sharing(request)) ?? original.fetch(request, env, context); } };
`);
await fs.writeFile(path.join(release, 'Dockerfile'), `FROM europe-west1-docker.pkg.dev/cardvault-715ac/cloud-run-source-deploy/domidex-web@sha256:65dc9fb215c46fee8141bb015113ac332dd0fb568ac6e26f8837666e84024f61
USER root
RUN node -e "const fs=require('node:fs'),c=require('node:crypto'),p='/app/dist/server/index.js';if(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!=='${expected}')throw Error('BASE_RUNTIME_CHANGED');fs.renameSync(p,'/app/dist/server/index-before-sharing.js')"
RUN node -e "const fs=require('node:fs'),c=require('node:crypto');if(c.createHash('sha256').update(fs.readFileSync('/app/backend/security/deletion.mjs')).digest('hex')!=='${deletionHash}')throw Error('BASE_DELETION_CHANGED')"
COPY deletion-sharing-compat.mjs /app/backend/security/deletion.mjs
COPY index.js /app/dist/server/index.js
COPY backend /app/backend/binder-sharing
RUN ln -s /app/backend/security/node_modules /app/backend/binder-sharing/node_modules
COPY public /app/binder-sharing-public
RUN node -e "import('/app/backend/binder-sharing/sharing.mjs').then(m=>{if(typeof m.createBinderShare!=='function')throw Error('SHARING_IMPORT_FAILED')})"
USER node
`);
const image = process.env.SHARING_IMAGE || 'europe-west1-docker.pkg.dev/cardvault-715ac/cloud-run-source-deploy/domidex-web:binder-sharing-20260922';
await fs.writeFile(path.join(release, 'cloudbuild.yaml'), `steps:\n  - name: gcr.io/cloud-builders/docker\n    args: ['build', '-t', '${image}', '.']\nimages:\n  - ${image}\n`);
console.log(JSON.stringify({ release, image, existingFrontendRebuilt: false, existingDeletionDelta: 'include owned privateBinderShares in existing deletion inventory' }));
