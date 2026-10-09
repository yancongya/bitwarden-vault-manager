import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [pidText, runtimeRoot, markerName, markerContents] = process.argv.slice(2);
const packPid = Number.parseInt(pidText, 10);
const markerPath = path.join(runtimeRoot, markerName);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!Number.isInteger(packPid) || packPid <= 1) process.exit(2);

while (fs.existsSync(markerPath)) {
  const probe = spawnSync('ps', ['-o', 'command=', '-p', String(packPid)], { encoding: 'utf8' });
  const command = probe.stdout?.trim() || '';
  if (!command || probe.status !== 0 || !(/\bnpm (?:pack|publish)\b|npm-cli\.js\s+(?:pack|publish)/.test(command))) break;
  await delay(100);
}

if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf8') === markerContents) {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
