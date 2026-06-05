# edge-fn-client-auth Specification

## Purpose

Define the CLIENT-SIDE contract for calling FindMyNest's Supabase Edge Functions so that the server can authenticate every sensitive call via JWT and so the client never asserts identity in the request body. This closes the open-mail-relay risk on `send-email` and the spoofable `renter_id` / `user_id` payloads on the other functions.

## Requirements

### Requirement: Authenticated Edge Function Calls MUST Include Authorization: Bearer

For every Edge Function that requires the caller's identity, the client SHALL send an HTTP request whose headers include `Authorization: Bearer <access_token>` where `<access_token>` is the current session's Supabase JWT. The client SHOULD obtain the token via the live session getter (e.g., `getSession()`) at request time, NOT from a cached variable populated at page load.

In-scope functions (this change):

| Function | Auth required (client-side) |
|----------|-----------------------------|
| `submit-enquiry` | MUST |
| `send-email` | MUST (closes open mail relay; see Open Questions) |
| `rent-estimate` | MUST (see Open Questions for public-mode alternative) |
| `flatmate-match` | MUST (see Open Questions for public-mode alternative) |

### Requirement: Client MUST NOT Send Identity Fields in the Body

When a session JWT is available, the client SHALL NOT include `renter_id`, `landlord_id`, `user_id`, or the current user's `email` in the Edge Function request body. The Edge Function derives identity from `auth.uid()` against the verified JWT.

The client MAY still send domain identifiers that do not represent the caller (e.g., a target `listing_id`, a target `landlord_id` the enquiry is addressed to, an explicit `to_email` for outbound delivery as long as it is not used to bypass server-side authorization).

#### Scenario: submit-enquiry sends Authorization header and no renter_id in body

- GIVEN a logged-in renter on a listing detail page
- WHEN they submit the enquiry form
- THEN the outbound request to `/functions/v1/submit-enquiry` MUST include header `Authorization: Bearer <jwt>` AND the JSON body MUST NOT contain a `renter_id` or `user_id` key
- Evidence: DevTools Network screenshot of the request — Request Headers section showing `Authorization: Bearer ey...` and Request Payload section showing no `renter_id`/`user_id`.

#### Scenario: send-email is authenticated (closes open mail relay)

- GIVEN a logged-out visitor crafts a request to `/functions/v1/send-email` with arbitrary `to` / `subject` / `body`
- WHEN the request is sent WITHOUT an `Authorization: Bearer` header (simulated via DevTools or `curl`)
- THEN the function MUST return `401 Unauthorized` (server-side enforcement) AND the client codebase MUST never call `send-email` without attaching `Authorization: Bearer`
- Evidence: `rg "fetch\(.*send-email" index.html` annotated to show every hit attaches `Authorization`; DevTools Network screenshot of the in-app send-email call showing the header.

#### Scenario: rent-estimate call attaches Authorization

- GIVEN a logged-in user on the rent-estimate panel
- WHEN they request an estimate
- THEN the outbound request to `/functions/v1/rent-estimate` MUST include `Authorization: Bearer <jwt>`
- Evidence: DevTools Network screenshot showing the header on the request.

#### Scenario: flatmate-match call attaches Authorization

- GIVEN a logged-in user on the flatmate-match panel
- WHEN they request a match
- THEN the outbound request to `/functions/v1/flatmate-match` MUST include `Authorization: Bearer <jwt>`
- Evidence: DevTools Network screenshot showing the header on the request.

#### Scenario: Static audit confirms identity fields are gone from request bodies

- GIVEN the post-change codebase
- WHEN an operator runs `rg "renter_id\s*:\s*(u\.auth_id|user\.id|session\.user)" index.html` and `rg "user_id\s*:\s*(u\.auth_id|user\.id|session\.user)" index.html`
- THEN both commands MUST return 0 hits inside any Edge-Function `fetch` call body
- Evidence: terminal screenshot of the `rg` output attached to `verify-report.md`.

#### Scenario: Token is fetched live, not from a stale cached variable

- GIVEN a session that has been refreshed since page load
- WHEN the client makes a new Edge Function call
- THEN the `Authorization` header MUST carry the CURRENT `access_token` returned by the live session getter — NOT a stale token saved at login
- Evidence: DevTools Application > Storage shows the new token; DevTools Network shows the same token (last ~12 chars) in the `Authorization` header.

## Non-Goals

- Server-side Edge Function code changes. Those live in a separate Supabase project and ship under a coordinated, separate change.
- RLS policy review (separate change).
- Per-function rate limiting on the server side.
- Replacing direct `fetch` with the `supabase-js` SDK helpers.

## Open Questions

- **Are `rent-estimate` and `flatmate-match` intended to be public (unauthenticated) features?**
  - If YES → the auth requirement above is relaxed for them, BUT the server side MUST add rate-limiting (per-IP), bot mitigation (captcha or proof-of-work), and an abuse cap (daily quota). Specify in design.
  - If NO → keep the MUST as written. Default assumption is NO (logged-in users only).
- **Authorization for `send-email`**: confirmed MUST. Open sub-question — does the client need to send a target `to_email`, or is the recipient always derivable server-side from `listing_id` + `auth.uid()`? Design phase resolves so we minimize spoofable inputs.
- **JWT availability vs. anonymous flow**: the proposal mentions `submit-enquiry` may be called by anonymous users in some funnels (open question). If anonymous enquiry is allowed, the server MUST authenticate via a different mechanism (turnstile/captcha + server-issued one-time token) — to be resolved in design.
