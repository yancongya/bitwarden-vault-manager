import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(harnessRoot, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bwvault-package-smoke-'));
const fixtureRoot = path.join(tempRoot, 'project');
const fixtureHarness = path.join(fixtureRoot, 'agent-harness');
const fixtureSource = path.join(fixtureRoot, 'src');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

function copyTree(source, destination) {
  fs.cpSync(source, destination, { recursive: true, dereference: false });
}

try {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  copyTree(harnessRoot, fixtureHarness);
  fs.mkdirSync(fixtureSource, { recursive: true });

  for (const file of ['crypto.js', 'bitwarden-api.js']) {
    fs.copyFileSync(path.join(repoRoot, 'src', file), path.join(fixtureSource, file));
  }

  const dryRun = run('npm', ['pack', '--dry-run', '--json'], { cwd: fixtureHarness });
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  const dryRunFiles = JSON.parse(dryRun.stdout)[0].files.map((file) => file.path);
  assert.ok(dryRunFiles.includes('runtime-src/crypto.js'));
  assert.ok(dryRunFiles.includes('runtime-src/bitwarden-api.js'));
  assert.ok(!dryRunFiles.includes('runtime-src/.generated-by-bwvault-prepack'));
  assert.ok(!fs.existsSync(path.join(fixtureHarness, 'runtime-src')), 'dry-run must clean staged files');

  const invalidDestination = path.join(tempRoot, 'not-a-directory');
  fs.writeFileSync(invalidDestination, 'block npm pack destination');
  const failedPack = run('npm', ['pack', '--json', '--pack-destination', invalidDestination], { cwd: fixtureHarness });
  assert.notEqual(failedPack.status, 0, 'invalid pack destination should fail');
  for (let attempt = 0; attempt < 30 && fs.existsSync(path.join(fixtureHarness, 'runtime-src')); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(!fs.existsSync(path.join(fixtureHarness, 'runtime-src')), 'failed pack must clean staged files');

  const packDestination = path.join(tempRoot, 'tarballs');
  fs.mkdirSync(packDestination);
  const pack = run('npm', ['pack', '--json', '--pack-destination', packDestination], { cwd: fixtureHarness });
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  assert.ok(!fs.existsSync(path.join(fixtureHarness, 'runtime-src')), 'pack must clean staged files');

  const tarball = path.join(packDestination, JSON.parse(pack.stdout)[0].filename);
  const installRoot = path.join(tempRoot, 'isolated-install');
  const packageRoot = path.join(installRoot, 'node_modules', 'bwvault');
  const binDir = path.join(installRoot, 'node_modules', '.bin');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  const extract = run('tar', ['-xzf', tarball, '-C', packageRoot, '--strip-components=1']);
  assert.equal(extract.status, 0, extract.stderr || extract.stdout);

  const executable = path.join(packageRoot, 'bin', 'bwvault.js');
  fs.chmodSync(executable, 0o755);
  fs.symlinkSync(executable, path.join(binDir, 'bwvault'));
  const help = run('bwvault', ['--help'], {
    cwd: installRoot,
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` },
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /bwvault/i);

  console.log('ok npm pack includes canonical runtime modules, cleans staging, and installed bwvault --help runs');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
