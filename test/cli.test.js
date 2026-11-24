import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install, FILES } from '../bin/cli.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const quiet = () => {};

function project(pkg = { name: '@me/My Shop', scripts: { start: 'node server.js' } }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syno-sail-node-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

test('install writes every file under its real (dotted) name', () => {
  const dir = project();
  const { written, kept } = install(dir, { log: quiet });
  assert.equal(written.length, FILES.length);
  assert.equal(kept.length, 0);
  for (const f of ['Dockerfile', 'docker-compose.yml', '.env.docker.example', '.dockerignore',
    '.github/workflows/docker-build.yml', 'docker/scripts/entrypoint.sh', 'docker/scripts/backup.sh']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} is there`);
  }
});

test('the containers are named after the project; an unknown GitHub user stays a placeholder', () => {
  const dir = project();
  install(dir, { log: quiet });
  const env = fs.readFileSync(path.join(dir, '.env.docker.example'), 'utf8');
  assert.match(env, /^CONTAINER_NAME=my-shop$/m);
  assert.match(env, /^CONTAINER_REGISTRY_IMAGE=ghcr\.io\/<GITHUB_USER>\/my-shop:latest$/m);
  assert.ok(!env.includes('<APP_NAME>'), 'the app name is filled in everywhere');
});

test('the GitHub user comes from package.json, or from the git remote', () => {
  const a = project({ name: 'shop', scripts: { start: 'x' }, repository: { url: 'git+https://github.com/Some-User/shop.git' } });
  install(a, { log: quiet });
  assert.match(fs.readFileSync(path.join(a, '.env.docker.example'), 'utf8'), /^CONTAINER_REGISTRY_IMAGE=ghcr\.io\/some-user\/shop:latest$/m);

  const b = project({ name: 'game', scripts: { start: 'x' } });
  fs.mkdirSync(path.join(b, '.git'));
  fs.writeFileSync(path.join(b, '.git', 'config'), ['[remote "origin"]', '\turl = git@github.com:other/game.git', ''].join('\n'));
  install(b, { log: quiet });
  assert.match(fs.readFileSync(path.join(b, '.env.docker.example'), 'utf8'), /^CONTAINER_REGISTRY_IMAGE=ghcr\.io\/other\/game:latest$/m);
});

test('shell scripts keep Unix line endings, so they run inside the container', () => {
  const dir = project();
  install(dir, { log: quiet });
  for (const f of ['docker/scripts/entrypoint.sh', 'docker/scripts/backup.sh']) {
    const body = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(body.startsWith('#!/bin/sh\n'), `${f} starts with a shell line`);
    assert.ok(!body.includes('\r'), `${f} has no Windows line endings`);
  }
});

test('a second run keeps your changes unless --force', () => {
  const dir = project();
  install(dir, { log: quiet });
  const compose = path.join(dir, 'docker-compose.yml');
  fs.writeFileSync(compose, '# mine\n');
  const again = install(dir, { log: quiet });
  assert.equal(again.written.length, 0);
  assert.equal(fs.readFileSync(compose, 'utf8'), '# mine\n');
  install(dir, { force: true, log: quiet });
  assert.notEqual(fs.readFileSync(compose, 'utf8'), '# mine\n');
});

test('it refuses a folder that is not a Node project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syno-sail-node-empty-'));
  assert.throws(() => install(dir, { log: quiet }), /No package\.json/);
});

test('it warns when there is no start script to run', () => {
  const dir = project({ name: 'x' });
  const lines = [];
  install(dir, { log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => l.includes('no "start" script')));
});

test('the command line works end to end', () => {
  const dir = project();
  const out = execFileSync(process.execPath, [CLI, 'install', '--dir', dir], { encoding: 'utf8' });
  assert.match(out, /wrote {2}Dockerfile/);
  assert.ok(fs.existsSync(path.join(dir, '.dockerignore')));
});
