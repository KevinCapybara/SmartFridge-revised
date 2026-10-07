// Fails if files contain something that looks like an API key / token, or if a file
// that should never be committed (.env, private keys, fridge backups) is included.
//
//   node scripts/check-secrets.mjs --staged   what the pre-commit hook runs (staged files)
//   node scripts/check-secrets.mjs --all      every tracked file (npm run check-secrets, CI)
//
// Findings never print the whole secret. A deliberate fake (e.g. in docs) can carry
// the comment "secret-scan: allow" on the same line.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { FORBIDDEN_FILES, findSecrets } from '../lib/secret-patterns.js';

const staged = process.argv.includes('--staged');
const git = (...args) => execFileSync('git', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });

const files = git(...(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'] : ['ls-files', '-z']))
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|pdf)$/i;
const SKIP = /(^|\/)package-lock\.json$/; // long integrity hashes, never secrets
const problems = [];

for (const file of files) {
  for (const { name, re } of FORBIDDEN_FILES) {
    if (re.test(file)) problems.push(`${file}: ${name} must not be committed`);
  }
  if (BINARY.test(file) || SKIP.test(file)) continue;

  let text;
  try {
    text = (staged ? git('show', `:${file}`) : fs.readFileSync(file)).toString('utf8');
  } catch {
    continue; // deleted or unreadable
  }
  if (text.includes('\0')) continue; // binary

  for (const { line, name, preview } of findSecrets(text)) problems.push(`${file}:${line}: looks like a ${name} (${preview})`);
}

if (problems.length) {
  console.error(`\nSecret check FAILED - ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nKeep keys in .env (git-ignored) or in Vercel environment variables, never in files you commit.' +
      '\nIf a real key was exposed, revoke it at the provider first. Then remove it from the file and try again.' +
      '\nA harmless fake can be allowed with a "secret-scan: allow" comment on that line.\n',
  );
  process.exit(1);
}
console.log(`Secret check passed (${files.length} ${staged ? 'staged' : 'tracked'} files).`);
