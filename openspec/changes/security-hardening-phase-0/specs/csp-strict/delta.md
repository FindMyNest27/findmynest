# Delta: csp-strict

- **Capability**: `csp-strict`
- **Delta type**: `create`

## Change Description

Introduce a new spec that (a) removes `'unsafe-inline'` from the `script-src` CSP directive served by Vercel and (b) requires all interactive elements in `index.html` to be wired with `addEventListener` rather than inline `on*=` attributes. Verification is manual: `curl -sI` for the header and `rg` for the inline-handler audit, plus a smoke-test of every interactive surface.

## Affected Files

- `vercel.json:8` — CSP header definition (`script-src` directive).
- `index.html` — ~85 inline `onclick=` / `onsubmit=` / `onchange=` handlers to migrate to `addEventListener` calls.
- `index.html` — wiring script blocks (loaded from `'self'`) that own the new `addEventListener` registrations.
