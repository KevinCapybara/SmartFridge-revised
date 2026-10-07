// What a leaked credential looks like. One list shared by the pre-commit scanner
// (scripts/check-secrets.mjs) and the log redaction (lib/redact.js), so the code
// that stops secrets reaching git and the code that stops them reaching logs agree.

export const SECRET_PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  // 32+ characters so short placeholders like "sk-test" never match.
  { name: 'OpenAI API key', re: /sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|github_pat_[A-Za-z0-9_]{50,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: 'Hard-coded secret assignment',
    // API_KEY = "...", ACCESS_CODE: '...' with a real-looking value (16+ chars, not a placeholder)
    re: /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|ACCESS_CODE)\b\s*[:=]\s*['"]?(?!your|xxx|changeme|example|<)[A-Za-z0-9_\-+/=.]{16,}/i,
  },
];

/** Files that should never be committed, whatever they contain. */
export const FORBIDDEN_FILES = [
  { name: 'environment file (.env)', re: /(^|\/)\.env(\.(?!example$)[^/]*)?$/ },
  { name: 'private key / certificate file', re: /\.(pem|key|p12|pfx|keystore|jks)$/i },
  { name: 'SSH private key', re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/ },
  { name: 'npm config (can hold auth tokens)', re: /(^|\/)\.npmrc$/ },
  { name: 'fridge backup (your personal data)', re: /(^|\/)smartfridge-backup-[^/]*\.json$/ },
];

/** Marker that lets a line through, e.g. a deliberate fake key in documentation. */
export const ALLOW_MARKER = 'secret-scan: allow';

/** Find secrets in text. Returns [{ line, name, preview }] - the preview never contains the whole secret. */
export function findSecrets(text) {
  const found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const { name, re } of SECRET_PATTERNS) {
      const m = re.exec(line);
      if (m) found.push({ line: i + 1, name, preview: `${m[0].slice(0, 4)}…(${m[0].length} chars)` });
    }
  });
  return found;
}
