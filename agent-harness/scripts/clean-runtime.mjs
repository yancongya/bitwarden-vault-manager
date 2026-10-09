import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(packageRoot, 'runtime-src');
const markerPath = path.join(runtimeRoot, '.generated-by-bwvault-prepack');
const markerContents = 'Generated from the repository src/ directory for npm packaging.\n';

if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf8') === markerContents) {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
