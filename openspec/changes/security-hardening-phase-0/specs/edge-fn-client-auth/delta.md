# Delta: edge-fn-client-auth

- **Capability**: `edge-fn-client-auth`
- **Delta type**: `create`

## Change Description

Introduce a new spec that enforces the CLIENT-SIDE contract for Supabase Edge Function calls: every authenticated call MUST attach `Authorization: Bearer <jwt>` and MUST NOT include caller-identity fields (`renter_id`, `user_id`, current-user `email`) in the request body. Covers `submit-enquiry`, `send-email`, `rent-estimate`, `flatmate-match`. `send-email` MUST be authenticated (closes the current open-mail-relay risk). Public-mode for `rent-estimate` / `flatmate-match` is flagged as an open question for design.

## Affected Files

- `index.html:2382` — `submit-enquiry` call site.
- `index.html:3123` — `send-email` call site (currently unauthenticated — open mail relay).
- `index.html:3128` — current `renter_id: u.auth_id` in the request body — to remove.
- `index.html:4587` — `rent-estimate` (or related AI) call site.
- `index.html:4682` — `flatmate-match` (or related AI) call site.
- `index.html` (session getter helper) — must expose the live access token at call time.

## Out of Scope (Cross-System)

- Edge Function server code that validates the JWT and reads `auth.uid()` lives in a separate Supabase project and is governed by a separate change. This spec governs only the CLIENT-SIDE contract.
