import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(packageRoot, '..', 'src');
const runtimeRoot = path.join(packageRoot, 'runtime-src');
const markerName = '.generated-by-bwvault-prepack';
const markerContents = 'Generated from the repository src/ directory for npm packaging.\n';
const sharedFiles = ['crypto.js', 'bitwarden-api.js'];

function removeGeneratedRuntime() {
  const marker = path.join(runtimeRoot, markerName);
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === markerContents) {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

function findPackProcess() {
  let pid = process.ppid;
  const ancestors = [];
  while (pid > 1) {
    const command = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    const parent = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' });
    const commandLine = command.stdout?.trim() || '';
    const parentPid = Number.parseInt(parent.stdout?.trim() || '', 10);
    ancestors.push(`${pid}: ${commandLine}`);
    if (/\bnpm (?:pack|publish)\b|npm-cli\.js\s+(?:pack|publish)/.test(commandLine)) return pid;
    if (!Number.isInteger(parentPid) || parentPid <= 1 || parentPid === pid) break;
    pid = parentPid;
  }
  return ancestors;
}

if (fs.existsSync(runtimeRoot)) {
  throw new Error(`Refusing to overwrite existing package staging directory: ${runtimeRoot}`);
}

try {
  const packProcess = findPackProcess();
  if (!Number.isInteger(packProcess)) {
    throw new Error(`Could not identify the npm pack process for safe staging cleanup. Ancestors: ${packProcess.join(' | ')}`);
  }

  for (const file of sharedFiles) {
    if (!fs.statSync(path.join(sourceRoot, file)).isFile()) {
      throw new Error(`Canonical shared runtime module is missing: ${path.join(sourceRoot, file)}`);
    }
  }

  fs.mkdirSync(runtimeRoot);
  fs.writeFileSync(path.join(runtimeRoot, markerName), markerContents, { flag: 'wx' });
  for (const file of sharedFiles) {
    fs.copyFileSync(path.join(sourceRoot, file), path.join(runtimeRoot, file), fs.constants.COPYFILE_EXCL);
  }

  // npm does not run postpack when writing the tarball itself fails. Keep a
  // detached cleanup watcher until the owning npm pack/publish process exits.
  const cleanup = spawn(process.execPath, [
    path.join(packageRoot, 'scripts', 'watch-pack-cleanup.mjs'),
    String(packProcess),
    runtimeRoot,
    markerName,
    markerContents,
  ], { detached: true, stdio: 'ignore' });
  cleanup.unref();
} catch (error) {
  removeGeneratedRuntime();
  throw error;
}
