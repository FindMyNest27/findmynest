# Delta: email-phishing-defense

- **Capability**: `email-phishing-defense`
- **Delta type**: `create`

## Change Description

Introduce a new spec that closes the brand-spoofing phishing relay in `send-email`. The function currently trusts a client-supplied `confirmationUrl` for the signup flow, allowing an attacker to craft a FindMyNest-branded email delivered via the domain's SPF/DKIM reputation with an arbitrary link. The fix requires `send-email` to ALWAYS generate links server-side via `admin.generateLink` for both signup and recovery flows, and to IGNORE the client `confirmationUrl` entirely.

## Affected Files

- `supabase/functions/send-email/index.ts` — extend the existing server-side recovery link generation to cover signup; discard client `confirmationUrl`

## Out of Scope (Cross-System)

- Adding `verify_jwt` to `send-email` (it is pre-auth by design; no session exists at signup/recovery time).
- Adding custom rate-limiting to `send-email` (lean on Supabase Auth's native rate-limiting — no new infra).
- Changes to `index.html` L2553 `sendEmail` call site (no behavioral change visible to the client beyond link source; client still passes `type`, `to`, and optionally `confirmationUrl` which is now ignored server-side).
