// Runs on `npm install` (the "prepare" script): point git at the repo's hooks so the
// secret scan runs before every commit. Harmless where there is no git repo (Vercel).
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  console.log('Git hooks enabled: commits are scanned for secrets.');
} catch {
  /* not a git checkout, or git isn't installed - nothing to do */
}
