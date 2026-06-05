# Delta: edge-fn-client-auth

- **Capability**: `edge-fn-client-auth`
- **Delta type**: `modify` (supersedes phase-0 `edge-fn-client-auth`)

## Change Description

The phase-0 `edge-fn-client-auth` spec defined the client-side header contract but explicitly flagged it as **security theater** because the server-side validators did not yet exist. This change closes that gap: server-side `verify_jwt` is now in place for all three gated functions (`submit-enquiry`, `rent-estimate`, `flatmate-match`), so the `Authorization: Bearer` header now has a real enforcer behind it.

Changes relative to phase-0:

1. **`send-email` removed from the auth requirement.** Phase-0 incorrectly classified `send-email` as a logged-in call. Code review of `index.html` L2553 confirms it is called during signup and recovery — inherently pre-auth. `send-email` SHALL NOT require `Authorization: Bearer` on the client side. Phase-0 scenario "send-email is authenticated" is SUPERSEDED by `email-phishing-defense`, which addresses the phishing risk differently (server-side link generation).
2. **`rent-estimate` header updated.** Phase-0 required a user session JWT. The final policy (per #1243) is that `rent-estimate` uses the project/anon JWT (it is public discovery). The client SHALL send `Authorization: Bearer <supabase-anon-key>` (or the logged-in user JWT if a session exists) — not require a user session.
3. **Explicit correlation with server validators.** B4.4 client header changes MUST ship together with the B4.1–B4.3 server-side validators; a header MUST NOT be added without a validator behind it.

## Affected Files

- `index.html:3291` — `submit-enquiry` call: add `Authorization: Bearer ${session.access_token}`; stop sending `renter_id` as an identity field
- `index.html:4856` — `flatmate-match` call: add `Authorization: Bearer ${session.access_token}`; stop sending renter PII as identity source
- `index.html:4748` — `rent-estimate` call: add `Authorization: Bearer <project-jwt>`

## Out of Scope (Cross-System)

- `index.html:2553` (`sendEmail`) — not modified; pre-auth call, no header required.
- Server-side validator changes (governed by `edge-fn-server-auth`).
- Removing the phase-0 spec file (archival is done in `sdd-archive`; this delta supersedes the behavior).
