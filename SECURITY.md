# Security

This repository is public. It contains code only: no API keys, tokens, passwords or personal data.

## Where secrets live

| Secret | Where it goes | Never |
| --- | --- | --- |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Vercel environment variables, or a local `.env` file | in source, docs, tests or commits |
| `APP_ACCESS_CODE` | Vercel environment variables or `.env` | in source or the browser bundle |
| Your fridge data | On your own device (localStorage) | on the server |

`.env` and other private files are git-ignored. `.env.example` has only blank placeholders.

## How leaks are prevented

1. **Pre-commit hook.** `npm install` enables `.githooks/pre-commit`, which blocks a commit containing an API-key-shaped string, or a file that must stay private (`.env`, private keys, fridge backups). Run it by hand with `npm run check-secrets`.
2. **CI.** GitHub Actions runs the same scan, plus the tests, on every push and pull request, so skipping the hook (`--no-verify`) doesn't get past it.
3. **GitHub secret scanning and push protection** are turned on for this repository.
4. **Log redaction.** Anything that looks like a key is replaced with `[redacted]` before it is written to server logs.
5. **No key reaches the browser.** The phone talks to the server's `/api/...` endpoints; only the server holds keys. On Vercel the AI endpoints refuse to use any key unless `APP_ACCESS_CODE` is also set, compare it in constant time, and never return it.

## If a key is exposed

Treat it as compromised, even if you deleted it straight away. Git history and forks keep old copies.

1. **Revoke it at the provider first**: [console.anthropic.com](https://console.anthropic.com) or [platform.openai.com](https://platform.openai.com/api-keys). Make a new one.
2. Put the new key only in Vercel's environment variables or `.env`.
3. Remove the old value from the files, and rewrite history if you want it gone from there too.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting (Security tab > Report a vulnerability) instead of opening a public issue.
