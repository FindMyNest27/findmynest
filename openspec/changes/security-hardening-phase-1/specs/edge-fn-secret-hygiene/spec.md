# edge-fn-secret-hygiene Specification

## Purpose

Ensure that no Edge Function source file in `supabase/functions/` ever contains an inline API key or secret, and that every HTTP response from those functions carries a `Access-Control-Allow-Origin` value locked to the FindMyNest production origin, preventing both credential exfiltration (via source leak or deploy inspection) and cross-origin abuse.

## Requirements

### Requirement: Edge Function Source Files MUST NOT Contain Inline Secrets

Every file under `supabase/functions/` SHALL source API keys and secrets exclusively via `Deno.env.get('<KEY_NAME>')`. No file SHALL contain a string that matches `re_[A-Za-z0-9]` (Resend key prefix) or `gsk_[A-Za-z0-9]` (Groq key prefix) or any other bare provider key. The `Deno.env.get` pattern already used for `ANTHROPIC_API_KEY` is the canonical model.

Secrets that MUST be sourced from `Deno.env.get`:

| Secret | Environment variable name | Functions |
|--------|---------------------------|-----------|
| Resend API key | `RESEND_API_KEY` | `send-email`, `submit-enquiry` |
| Groq API key | `GROQ_API_KEY` | `rent-estimate`, `flatmate-match` |
| Anthropic API key | `ANTHROPIC_API_KEY` | `submit-enquiry` (already correct — no change) |

#### Scenario: Static scan returns 0 hits for known secret prefixes

- GIVEN the post-change codebase at the commit that imports the function sources
- WHEN an operator runs `rg "re_[A-Za-z0-9]|gsk_[A-Za-z0-9]" supabase/functions/`
- THEN the command MUST return 0 matches
- Evidence: terminal screenshot or copy of the `rg` output showing no matches, attached to `verify-report.md`.

#### Scenario: Every Deno.env.get call resolves at runtime (secrets are provisioned)

- GIVEN the four functions are deployed to the Supabase project
- WHEN an operator runs `supabase secrets list` (authenticated to the project)
- THEN the output MUST include `RESEND_API_KEY` and `GROQ_API_KEY`
- Evidence: redacted screenshot of `supabase secrets list` output showing those key names (values NOT shown), attached to `verify-report.md`.

#### Scenario: A function invoked in a live environment does not 500 on missing secret

- GIVEN the functions are deployed and secrets are provisioned
- WHEN an authorized user triggers each function via the client
- THEN no function SHALL return `500 Internal Server Error` due to an undefined `Deno.env.get` value
- Evidence: smoke-test DevTools Network screenshots showing 200 (or valid domain error, not 500) for each function call.

---

### Requirement: CORS on All Four Functions MUST Be Locked to the Production Origin

Every Edge Function's HTTP response (both preflight `OPTIONS` and actual requests) SHALL include the header `Access-Control-Allow-Origin: https://www.findmynest.co.nz`. The wildcard value `*` SHALL NOT appear in any `Access-Control-Allow-Origin` header returned by any of the four functions.

In-scope functions:

| Function | CORS origin (after change) |
|----------|---------------------------|
| `send-email` | `https://www.findmynest.co.nz` |
| `submit-enquiry` | `https://www.findmynest.co.nz` |
| `rent-estimate` | `https://www.findmynest.co.nz` |
| `flatmate-match` | `https://www.findmynest.co.nz` |

#### Scenario: CORS preflight from the production origin is allowed

- GIVEN a deployed function (e.g., `submit-enquiry`)
- WHEN a browser (or `curl`) sends an `OPTIONS` preflight with `Origin: https://www.findmynest.co.nz`
- THEN the response MUST include `Access-Control-Allow-Origin: https://www.findmynest.co.nz` and MUST NOT contain `Access-Control-Allow-Origin: *`
- Evidence: `curl -sI -X OPTIONS -H "Origin: https://www.findmynest.co.nz" <function-url>` output showing the locked header value, attached to `verify-report.md`.

#### Scenario: CORS preflight from a foreign origin is rejected

- GIVEN a deployed function (any of the four)
- WHEN an attacker sends an `OPTIONS` preflight with `Origin: https://evil.example.com`
- THEN the response MUST NOT include `Access-Control-Allow-Origin: https://evil.example.com` AND MUST NOT include `Access-Control-Allow-Origin: *`. The function SHALL NOT echo back a foreign origin.
- Evidence: `curl -sI -X OPTIONS -H "Origin: https://evil.example.com" <function-url>` output showing no matching CORS allow header, attached to `verify-report.md`.

#### Scenario: Static audit confirms no wildcard CORS in source

- GIVEN the post-change function source files
- WHEN an operator runs `rg "Access-Control-Allow-Origin.*\*" supabase/functions/`
- THEN the command MUST return 0 matches
- Evidence: terminal screenshot showing no matches, attached to `verify-report.md`.

## Non-Goals

- Secret rotation in external provider dashboards (Resend, Groq) — done by the operator outside this repo.
- Per-IP rate-limiting or abuse quotas — out of scope for this change (constraint: no new rate-limit infrastructure).
- CORS header tightening beyond `Allow-Origin` (e.g., `Allow-Methods`, `Allow-Headers` remain unchanged unless required).
- Supabase RLS policy review (separate change).

## Open Questions

None for this capability. The Anthropic key is already correct; the Resend and Groq patterns are unambiguous rewrites.
