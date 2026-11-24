#!/usr/bin/env node
// syno-sail-node install [--force] [--dir <project>]
//
// Copies the Synology Docker setup into a Node project, the way
// `php artisan syno-sail:install` does for Laravel. Existing files are kept
// unless --force is given, so a second run never wipes your changes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STUBS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stubs');

// Stubs are stored without leading dots (npm drops or renames some dotfiles
// when it packs a package); this maps each one to its real name.
export const FILES = Object.freeze([
  ['Dockerfile', 'Dockerfile'],
  ['docker-compose.yml', 'docker-compose.yml'],
  ['env.docker.example', '.env.docker.example'],
  ['dockerignore', '.dockerignore'],
  ['github/workflows/docker-build.yml', '.github/workflows/docker-build.yml'],
  ['docker/scripts/entrypoint.sh', 'docker/scripts/entrypoint.sh'],
  ['docker/scripts/backup.sh', 'docker/scripts/backup.sh'],
]);

export function install(projectDir, { force = false, log = console.log } = {}) {
  const pkgFile = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    throw new Error(`No package.json in ${projectDir}. Run this from your Node project's folder.`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));

  const result = { written: [], kept: [] };
  for (const [from, to] of FILES) {
    const target = path.join(projectDir, to);
    if (fs.existsSync(target) && !force) {
      result.kept.push(to);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let body = fs.readFileSync(path.join(STUBS, from), 'utf8');
    // Fill in the placeholders we can work out: the app's name (so two stacks
    // never clash) and the GitHub user. Anything unknown stays <UPPERCASE>.
    if (to === '.env.docker.example') body = fillPlaceholders(body, projectDir, pkg);
    fs.writeFileSync(target, body.replace(/\r\n/g, '\n'));
    if (to.endsWith('.sh')) fs.chmodSync(target, 0o755);
    result.written.push(to);
  }

  for (const f of result.written) log(`  wrote  ${f}`);
  for (const f of result.kept) log(`  kept   ${f} (already there; use --force to replace it)`);
  if (!pkg.scripts || !pkg.scripts.start) {
    log('\n  Note: package.json has no "start" script. The container runs `npm start`, so add one.');
  }
  return result;
}

export function fillPlaceholders(body, projectDir, pkg) {
  let out = body.replaceAll('<APP_NAME>', slug(pkg.name || path.basename(projectDir)));
  const owner = githubOwner(projectDir, pkg);
  if (owner) out = out.replaceAll('<GITHUB_USER>', owner);
  return out;
}

// The GitHub user from package.json "repository", else from the git remote.
function githubOwner(projectDir, pkg) {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const fromUrl = (url) => (String(url || '').match(/github\.com[/:]([^/]+)\//i) || [])[1];
  let owner = fromUrl(repo);
  if (!owner) {
    try {
      const config = fs.readFileSync(path.join(projectDir, '.git', 'config'), 'utf8');
      owner = fromUrl((config.match(/\[remote "origin"\][^[]*?url = (.+)/) || [])[1]);
    } catch {
      // not a git checkout: leave the placeholder for the user
    }
  }
  return owner ? owner.toLowerCase() : null;
}

function slug(name) {
  return String(name).replace(/^@[^/]+\//, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'node-app';
}

function main(argv) {
  const args = argv.slice(2);
  const command = args.find((a) => !a.startsWith('-')) || 'help';
  const force = args.includes('--force');
  const dirAt = args.indexOf('--dir');
  const dir = path.resolve(dirAt >= 0 && args[dirAt + 1] ? args[dirAt + 1] : process.cwd());

  if (command !== 'install') {
    console.log('Usage: syno-sail-node install [--force] [--dir <project folder>]');
    return command === 'help' ? 0 : 1;
  }
  console.log('Installing SynoSail (Node) configuration...');
  try {
    install(dir, { force });
  } catch (err) {
    console.error(`\n  ${err.message}`);
    return 1;
  }
  console.log('\nDone. Check docker-compose.yml and .env.docker.example, then see the README for the NAS steps.');
  return 0;
}

// run only when called as a command, not when imported by the tests
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exitCode = main(process.argv);
