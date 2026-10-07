import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOW_MARKER, FORBIDDEN_FILES, findSecrets } from '../lib/secret-patterns.js';
import { redact } from '../lib/redact.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Fake credentials are assembled at runtime so this file itself never contains a key-shaped string.
const fake = {
  anthropic: 'sk-ant-' + 'aB3dE6gH9jK2mN5pQ8sT'.repeat(2),
  openai: 'sk-' + 'proj-' + 'aB3dE6gH9jK2mN5pQ8sT0vW1xY'.repeat(2),
  github: 'ghp_' + 'aB3dE6gH9jK2mN5pQ8sT0vW1xY4zA7bC0dE3'.slice(0, 36),
  google: 'AIza' + 'SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8'.slice(0, 35),
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  privateKey: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
};

test('findSecrets: detects real-looking credentials and never returns the whole value', () => {
  for (const [kind, value] of Object.entries(fake)) {
    const hits = findSecrets(`const x = "${value}";`);
    assert.ok(hits.length >= 1, `${kind} should be detected`);
    assert.ok(!JSON.stringify(hits).includes(value), `${kind}: preview must not contain the whole secret`);
    assert.equal(hits[0].line, 1);
  }

  const assignment = findSecrets(['ok = 1', 'ANTHROPIC_API_KEY=' + 'abcdef0123456789abcdef'].join('\n'));
  assert.equal(assignment.length, 1);
  assert.equal(assignment[0].line, 2);
  assert.equal(findSecrets('APP_ACCESS_CODE: "' + 'correct-horse-battery-staple' + '"').length, 1);
});

test('findSecrets: placeholders, empty values, env lookups and allow-marked lines are fine', () => {
  const fine = [
    'ANTHROPIC_API_KEY=',
    'OPENAI_API_KEY=your-key-here',
    'APP_ACCESS_CODE: "sesame"', // too short to be a real secret, used by tests
    'const key = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;',
    'resolveConfig({ ANTHROPIC_API_KEY: "sk-ant-test" })',
    "Set ANTHROPIC_API_KEY on the server",
    `const demo = "${fake.anthropic}"; // ${ALLOW_MARKER}`,
  ];
  for (const line of fine) assert.deepEqual(findSecrets(line), [], line);
});

test('forbidden files: .env variants, keys and fridge backups are blocked; .env.example is not', () => {
  const blocked = (f) => FORBIDDEN_FILES.some(({ re }) => re.test(f));
  for (const f of ['.env', '.env.local', '.env.production', 'api/.env', 'server.pem', 'keys/id_rsa', 'deploy.key', '.npmrc', 'smartfridge-backup-2026-10-07.json']) {
    assert.equal(blocked(f), true, f);
  }
  for (const f of ['.env.example', 'README.md', 'lib/ai.js', 'package.json', 'public/icons/icon-192.png']) {
    assert.equal(blocked(f), false, f);
  }
});

test('redact: strips credentials from log text, leaves everything else alone', () => {
  const message = `401 Incorrect API key provided: ${fake.openai}. Also ${fake.anthropic} and ${fake.github}`;
  const out = redact(message);
  assert.ok(!out.includes(fake.openai.slice(8)) && !out.includes(fake.anthropic.slice(8)) && !out.includes(fake.github.slice(8)));
  assert.ok(out.includes('[redacted]'));
  assert.equal(redact('The model response was cut off'), 'The model response was cut off');
  assert.ok(!redact(new Error(`boom ${fake.anthropic}`)).includes(fake.anthropic));
  assert.equal(redact(undefined), 'undefined');
});

test('check-secrets: the repository itself is clean', () => {
  const out = execFileSync(process.execPath, ['scripts/check-secrets.mjs', '--all'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /Secret check passed/);
});

test('check-secrets --staged: blocks a staged key and a staged .env, then passes once they are removed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-'));
  try {
    const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
    const scan = () => run(process.execPath, [path.join(root, 'scripts', 'check-secrets.mjs'), '--staged']);
    run('git', ['init', '-q']);

    fs.writeFileSync(path.join(dir, 'config.js'), `export const key = "${fake.anthropic}";\n`);
    fs.writeFileSync(path.join(dir, '.env'), 'ANTHROPIC_API_KEY=placeholder\n');
    fs.writeFileSync(path.join(dir, 'ok.js'), 'export const fine = 1;\n');
    run('git', ['add', '-A']);

    const blocked = scan();
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /config\.js:1: looks like a Anthropic API key/);
    assert.match(blocked.stderr, /\.env: environment file/);
    assert.ok(!blocked.stderr.includes(fake.anthropic), 'output must not echo the secret');

    run('git', ['rm', '-q', '--cached', '.env', 'config.js']);
    const clean = scan();
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /Secret check passed \(1 staged files\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
