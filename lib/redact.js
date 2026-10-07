import { SECRET_PATTERNS } from './secret-patterns.js';

/**
 * Replace anything that looks like an API key / token with [redacted]. Used on text
 * written to logs (error messages from SDKs sometimes echo part of a credential).
 */
export function redact(value) {
  let text = typeof value === 'string' ? value : value?.stack || value?.message || String(value);
  for (const { re } of SECRET_PATTERNS) {
    text = text.replace(new RegExp(re.source, `${re.flags.replace('g', '')}g`), '[redacted]');
  }
  return text;
}
