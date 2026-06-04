# edge-fn-server-auth Specification

## Purpose

Gate every FindMyNest Edge Function that operates under the Supabase `SERVICE_ROLE` key with server-side JWT validation, and ensure that the authenticated functions (`submit-enquiry`, `flatmate-match`) derive caller identity exclusively from the verified JWT rather than from any field the client supplies in the request body. This prevents unauthenticated LLM cost-amplification, nullifies client-asserted identity spoofing, and ensures that `SERVICE_ROLE` (which bypasses RLS) only executes on behalf of a cryptographically verified user.

## Requirements

### Requirement: `verify_jwt` MUST Be Enabled on submit-enquiry, rent-estimate, and flatmate-match

The Supabase `verify_jwt` option (or equivalent Deno-side JWT verification middleware) SHALL be enabled for `submit-enquiry`, `rent-estimate`, and `flatmate-match`. A request that arrives without a valid `Authorization: Bearer <jwt>` header MUST be rejected with HTTP 401 before any business logic executes. `send-email` is explicitly excluded because it is a pre-auth function (signup / recovery flows).

| Function | `verify_jwt` | Reason |
|----------|-------------|--------|
| `submit-enquiry` | MUST be ON | POST-login; SERVICE_ROLE; LLM call |
| `rent-estimate` | MUST be ON | Public discovery but paid LLM; JWT uses project/anon token |
| `flatmate-match` | MUST be ON | POST-login; SERVICE_ROLE; LLM call; PII |
| `send-email` | MUST remain OFF | Pre-auth by design (signup/recovery) |

#### Scenario: Anonymous call to submit-enquiry is rejected 401

- GIVEN `submit-enquiry` is deployed with `verify_jwt: true`
- WHEN an attacker sends a POST to `submit-enquiry` with no `Authorization` header
- THEN the function MUST return `HTTP 401 Unauthorized` and MUST NOT execute any business logic (no DB write, no LLM call, no email sent)
- Evidence: `curl -s -o /dev/null -w "%{http_code}" -X POST <submit-enquiry-url> -H "Content-Type: application/json" -d '{}'` returns `401`, attached to `verify-report.md`.

#### Scenario: Anonymous call to rent-estimate is rejected 401

- GIVEN `rent-estimate` is deployed with `verify_jwt: true`
- WHEN a caller sends a POST to `rent-estimate` with no `Authorization` header
- THEN the function MUST return `HTTP 401 Unauthorized` and MUST NOT invoke the Groq LLM
- Evidence: `curl -s -o /dev/null -w "%{http_code}" -X POST <rent-estimate-url> -H "Content-Type: application/json" -d '{}'` returns `401`, attached to `verify-report.md`.

#### Scenario: Anonymous call to flatmate-match is rejected 401

- GIVEN `flatmate-match` is deployed with `verify_jwt: true`
- WHEN a caller sends a POST to `flatmate-match` with no `Authorization` header
- THEN the function MUST return `HTTP 401 Unauthorized` and MUST NOT invoke the Groq LLM
- Evidence: same `curl` pattern as above against `flatmate-match`, returning `401`, attached to `verify-report.md`.

#### Scenario: A valid JWT grants access to rent-estimate

- GIVEN a logged-in user with a valid Supabase session
- WHEN their client sends a POST to `rent-estimate` with `Authorization: Bearer <valid-jwt>`
- THEN the function MUST return `HTTP 200 OK` (or a valid domain error, not 401/403)
- Evidence: DevTools Network screenshot of the in-app rent-estimate call showing `200`, attached to `verify-report.md`.

---

### Requirement: submit-enquiry and flatmate-match MUST Derive Identity from auth.uid() Only

For `submit-enquiry` and `flatmate-match`, the caller's identity (renter profile) SHALL be resolved exclusively by calling `supabase.auth.getUser(jwt)` on the verified JWT and looking up the renter profile by the resulting `auth.uid()`. The functions SHALL NOT use any `renter_id`, `renter`, `user_id`, `email`, or other identity field that the client supplies in the JSON request body. If the `auth.uid()` lookup fails to resolve a renter profile, the function MUST return `HTTP 403 Forbidden`.

#### Scenario: Forged renter_id in submit-enquiry body is ignored

- GIVEN `submit-enquiry` is deployed with JWT verification and server-side identity resolution
- WHEN an attacker sends a POST with a valid JWT (attacker's own session) and a JSON body containing `"renter_id": "<victim-uuid>"`
- THEN the function MUST resolve identity from `auth.uid()` of the ATTACKER's JWT, NOT from the supplied `renter_id` body field — the enquiry is attributed to the attacker's renter profile (or rejected if none exists), never to the victim
- Evidence: DB record inspection showing the enquiry row's `renter_id` matches the attacker's `auth_id`, not the forged value; or a 403 if the attacker has no renter profile; attached to `verify-report.md`.

#### Scenario: Forged renter PII body fields in flatmate-match are ignored

- GIVEN `flatmate-match` is deployed with JWT verification and server-side identity resolution
- WHEN an attacker sends a POST with a valid JWT and a JSON body containing full renter PII fields (name, age, budget, etc.) that differ from their actual profile
- THEN the function MUST resolve the renter's identity and preferences from the DB lookup keyed on `auth.uid()`, NOT from the supplied body fields
- Evidence: the match result or audit log shows the profile data sourced from the DB record, not from the body; attached to `verify-report.md`.

#### Scenario: auth.uid() lookup fails → 403 (no fallback to client field)

- GIVEN `submit-enquiry` is deployed with server-side identity resolution
- WHEN a call arrives with a valid JWT whose `auth.uid()` does not correspond to any renter profile in the DB
- THEN the function MUST return `HTTP 403 Forbidden` AND MUST NOT fall back to any `renter_id` or `user_id` field from the request body
- Evidence: test or documented code path confirming the 403 branch; attached to `verify-report.md`.

---

### Requirement: rent-estimate verify_jwt Uses the Project/Anon JWT

For `rent-estimate` only, the function SHALL accept both an authenticated user JWT (from a logged-in session) AND the project anon key as the bearer token, because the feature is public (discovery flow, no PII). The function SHALL enforce that SOME valid JWT is present (proving the request originates from the FindMyNest client), but SHALL NOT enforce a user-level identity claim.

#### Scenario: rent-estimate accepts a project anon JWT

- GIVEN `rent-estimate` is deployed with `verify_jwt: true`
- WHEN the client sends `Authorization: Bearer <supabase-anon-key>` (the project's published anon key)
- THEN the function MUST return `HTTP 200 OK` (or a valid domain error, not 401)
- Evidence: DevTools Network screenshot of the in-app rent-estimate call from a discovery-flow page (not logged in) showing `200`, attached to `verify-report.md`.

## Non-Goals

- `send-email` authentication (pre-auth by design; governed by `email-phishing-defense`).
- Adding a login wall to `rent-estimate` for the public discovery UX (open question deferred to a future policy flip).
- Supabase RLS policy review (separate change — second line of defense).
- Rate-limiting, captcha, or per-IP quotas (constraint: no new rate-limit infrastructure for this change).
- DB schema changes to the `auth_id`→renter-profile relationship (assumed to exist; no migration anticipated).

## Open Questions

- **`rent-estimate` — public vs. gated?** Current policy accepts the anon JWT for public discovery. If the user decides rent estimates should require login, the fix is a policy flip in a future change: require a user-level JWT + optionally add `auth.uid()` context. Not in scope here.
- **Server-side identity lookup query shape** (auth_id → renter profile join) — exact query deferred to `sdd-design`; the spec only requires rejection on lookup failure.
