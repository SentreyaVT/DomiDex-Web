import fs from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('the preserved compiled upload delegate ignores the framework route context', async () => {
  const source = fs.readFileSync('.domidex/security-gate/release/overlay/server/_next/static/route-CBKHjOu2.js', 'utf8');
  const captured = [];
  const vm = { uploadReport: (...args) => { captured.push(args); return new Response('{}'); } };
  runInNewContext(source.replace(/^import[^\n]+\n/, '').replace('export async function POST', 'async function POST') + '\nglobalThis.delegate = POST;', vm);
  const request = new Request('http://localhost');
  await vm.delegate(request, { params: Promise.resolve({}) });
  expect(captured).toEqual([[request]]);
});
