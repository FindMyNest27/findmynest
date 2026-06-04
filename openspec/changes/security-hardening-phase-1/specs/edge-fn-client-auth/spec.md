# edge-fn-client-auth Specification (Phase 1 — supersedes phase-0)

## Purpose

Define the CLIENT-SIDE contract for calling FindMyNest's Supabase Edge Functions now that server-side JWT validators are in place. The phase-0 version of this spec flagged adding the `Authorization: Bearer` header without a server-side validator as security theater. That gap is closed in this change: the header is now backed by a real enforcer on every gated function.

**Correction from phase-0**: `send-email` was incorrectly classified as a logged-in call. Code inspection of `index.html` L2553 confirms `send-email` is called for `type:'signup'` and `type:'recovery'` — both inherently pre-auth. `send-email` is therefore EXCLUDED from the Authorization requirement and governed instead by `email-phishing-defense`.

## Requirements

### Requirement: submit-enquiry and flatmate-match MUST Include Authorization: Bearer with User Session JWT

For `submit-enquiry` (L3291) and `flatmate-match` (L4856), the client SHALL send an HTTP request whose headers include `Authorization: Bearer <access_token>` where `<access_token>` is the current session's user JWT. The client SHALL obtain the token via the live session getter at request time, NOT from a variable populated at page load. Both call sites are POST-login (`if(!u) return` guard in place), so a valid user session is guaranteed to exist.

#### Scenario: submit-enquiry includes Authorization header with live user JWT

- GIVEN a logged-in renter on a listing detail page
- WHEN they submit the enquiry form (L3291 call site)
- THEN the outbound request to `/functions/v1/submit-enquiry` MUST include header `Authorization: Bearer <jwt>` where `<jwt>` is a non-empty, non-stale token from the live session getter
- Evidence: DevTools Network screenshot showing `Authorization: Bearer ey...` in the request headers, attached to `verify-report.md`.

#### Scenario: flatmate-match includes Authorization header with live user JWT

- GIVEN a logged-in renter on the flatmate-match panel (L4856 call site)
- WHEN they request a match
- THEN the outbound request to `/functions/v1/flatmate-match` MUST include `Authorization: Bearer <jwt>`
- Evidence: DevTools Network screenshot showing the header on the flatmate-match request, attached to `verify-report.md`.

---

### Requirement: rent-estimate MUST Include Authorization: Bearer with Project JWT

For `rent-estimate` (L4748), the client SHALL send `Authorization: Bearer <project-jwt>`. Because `rent-estimate` is a public discovery feature (no login required), the bearer token SHALL be the Supabase project anon key (or the user session JWT if a session is active). A logged-out user MUST still be able to trigger `rent-estimate` without being prompted to log in. Before this change, L4748 sends NO headers at all; that is the regression baseline being fixed.

#### Scenario: rent-estimate sends the project JWT (or user JWT if logged in)

- GIVEN a visitor on the rent-estimate panel (may or may not be logged in)
- WHEN they request an estimate
- THEN the outbound request to `/functions/v1/rent-estimate` MUST include `Authorization: Bearer <token>` (anon key or user JWT) AND MUST NOT be sent with zero headers as in the current L4748 baseline
- Evidence: DevTools Network screenshot showing the Authorization header on the rent-estimate call (discovery flow, not logged in), attached to `verify-report.md`.

---

### Requirement: Client MUST NOT Send Caller-Identity Fields in the Body for Authenticated Functions

When calling `submit-enquiry` or `flatmate-match`, the client SHALL NOT include `renter_id`, `user_id`, or any field that represents the logged-in user's identity in the JSON request body. The server derives identity exclusively from `auth.uid()`. The client MAY still send domain identifiers that are NOT the caller's identity (e.g., target `listing_id`, target `landlord_id`, preference filters, budget range).

#### Scenario: submit-enquiry body does not contain renter_id

- GIVEN the post-change `index.html` (L3291 call site)
- WHEN an operator runs `rg "renter_id\s*:" index.html` and inspects every match inside a `submit-enquiry` fetch body
- THEN no hit inside the `submit-enquiry` fetch body SHALL contain a self-referential identity field (e.g., `renter_id: u.auth_id`, `renter_id: user.id`)
- Evidence: terminal screenshot of the `rg` output; annotated to show the fetch body lacks identity fields, attached to `verify-report.md`.

#### Scenario: flatmate-match body does not contain renter PII used as identity source

- GIVEN the post-change `index.html` (L4856 call site)
- WHEN an operator inspects the JSON body sent to `flatmate-match`
- THEN the body MUST NOT contain the logged-in user's own email, UUID, or profile fields acting as the identity source — only preference/filter data the server uses after resolving identity server-side
- Evidence: DevTools Network screenshot of the flatmate-match request payload showing no caller-identity fields, attached to `verify-report.md`.

---

### Requirement: Client Headers MUST Ship Together With Server Validators (Sequencing)

The `Authorization: Bearer` header additions to `submit-enquiry` (L3291), `flatmate-match` (L4856), and `rent-estimate` (L4748) SHALL be committed and deployed in the same release window as the corresponding server-side `verify_jwt` validators (B4.1–B4.3). Adding a header without a validator (the phase-0 gap) is explicitly prohibited.

#### Scenario: Server validator is live before client header change is deployed

- GIVEN work unit B4.1 (`flatmate-match` server validator), B4.2 (`submit-enquiry`), and B4.3 (`rent-estimate`) are deployed to Supabase
- WHEN B4.4 client header changes are deployed to Vercel
- THEN the deployment order SHALL be: server validators first, client headers second — NOT the reverse
- Evidence: deployment timestamps in Supabase and Vercel dashboards showing server validators preceded client headers; attached to `verify-report.md`.

---

### Requirement: send-email Client Call Site MUST NOT Be Modified

The `index.html:2553` `sendEmail` call SHALL NOT have `Authorization: Bearer` added. `send-email` is pre-auth; adding a JWT requirement on the client would break signup and recovery flows for users without a session.

#### Scenario: sendEmail call site has no Authorization header

- GIVEN the post-change `index.html`
- WHEN an operator runs `rg -A5 "send-email" index.html` and inspects the L2553 fetch call
- THEN the fetch options MUST NOT include an `Authorization` header
- Evidence: terminal screenshot confirming the absence of Authorization in the sendEmail fetch options, attached to `verify-report.md`.

## Non-Goals

- `send-email` phishing defense (governed by `email-phishing-defense`).
- Server-side JWT validation logic (governed by `edge-fn-server-auth`).
- Token storage mechanism (governed by `auth-token-storage` from phase-0).
- Rate-limiting, captcha, or per-IP quotas (constraint: no new rate-limit infrastructure).
- Replacing direct `fetch` calls with `supabase-js` SDK helpers.

## Open Questions

None. Phase-0 open questions (public mode for `rent-estimate`/`flatmate-match`, anonymous enquiry) are resolved: `rent-estimate` uses the anon JWT (public), `flatmate-match` requires a user JWT (logged-in only), anonymous enquiry is out of scope.
