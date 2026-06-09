#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempDir = await mkdtemp(join(tmpdir(), 'pi-elixir-oxlint-'));
const probe = join(tempDir, 'floating-promise.ts');

try {
  await writeFile(probe, 'async function f(): Promise<void> { return; }\nf();\n');

  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'oxlint',
      '-c',
      join(root, '.oxlintrc.json'),
      '--type-aware',
      '--type-check',
      probe,
    ],
    { cwd: root, encoding: 'utf8' },
  );

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.status === 0 || !output.includes('typescript(no-floating-promises)')) {
    console.error('Expected oxlint to reject a floating Promise with typescript/no-floating-promises.');
    console.error(output.trim());
    process.exit(1);
  }

  console.log('Oxlint semantic guard ok: typescript/no-floating-promises is active');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
