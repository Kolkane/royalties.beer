// Copies runtime data assets that `tsc` does not emit into dist/.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync(join(root, 'dist', 'data'), { recursive: true });
cpSync(
  join(root, 'src', 'data', 'known-services.json'),
  join(root, 'dist', 'data', 'known-services.json'),
);

console.log('copied known-services.json -> dist/data/');
