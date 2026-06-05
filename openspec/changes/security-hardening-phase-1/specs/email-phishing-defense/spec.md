# email-phishing-defense Specification

## Purpose

Prevent `send-email` from acting as a brand-spoofing phishing relay. Because `send-email` is inherently pre-auth (it handles signup confirmation and password recovery — the caller has no session), the function receives requests before any JWT-level identity is available. The current implementation trusts a client-supplied `confirmationUrl` for the signup flow, allowing an attacker to control both the recipient address and the link href delivered inside a FindMyNest-branded email signed with the domain's SPF/DKIM reputation. The defense is to move link generation entirely to the server via `admin.generateLink` so the client can never influence the URL sent to the user.

## Requirements

### Requirement: send-email MUST Never Trust Client-Supplied confirmationUrl

The `send-email` Edge Function SHALL NOT use any `confirmationUrl`, `redirect_url`, `link`, `href`, or equivalent field from the client request body as the URL included in an outbound email. Regardless of what the client sends, the function SHALL discard those fields before constructing the email body.

This applies to ALL email types handled by `send-email`:

| Email type | Link generation |
|-----------|-----------------|
| `signup` | `admin.generateLink({ type: 'signup', email })` |
| `recovery` | `admin.generateLink({ type: 'recovery', email })` (already done — no regression) |

#### Scenario: Attacker-supplied confirmationUrl is ignored for signup

- GIVEN `send-email` is deployed with server-side link generation
- WHEN an attacker sends a POST to `send-email` with `type: 'signup'`, a victim `email`, and `confirmationUrl: 'https://evil.example.com/steal-credentials'`
- THEN the function MUST call `admin.generateLink` server-side and use ONLY that generated URL in the email body — the attacker-supplied `confirmationUrl` MUST NOT appear anywhere in the email
- Evidence: test email received at a controlled inbox showing a `https://www.findmynest.co.nz` (or Supabase-hosted) link, not `https://evil.example.com/...`; attached to `verify-report.md`.

#### Scenario: Attacker-supplied confirmationUrl is ignored for recovery

- GIVEN `send-email` is deployed with server-side link generation
- WHEN an attacker sends a POST with `type: 'recovery'`, a victim `email`, and a forged `confirmationUrl`
- THEN the same server-side generation behavior applies — the forged URL MUST be discarded and the `admin.generateLink` recovery URL MUST be used
- Evidence: same inbox verification as above for the recovery flow; attached to `verify-report.md`.

#### Scenario: Static audit confirms no use of client confirmationUrl in email body construction

- GIVEN the post-change `send-email/index.ts` source
- WHEN an operator inspects the code path that builds the email HTML/text body
- THEN the variable that supplies the link URL MUST be derived from `admin.generateLink(...)`, not from `req.json()` or any destructured client input field named `confirmationUrl`, `link`, `href`, or `url`
- Evidence: code review note in `verify-report.md` citing the specific lines that call `admin.generateLink` and the absence of a pass-through from client input to the email link.

---

### Requirement: send-email MUST Generate Links via admin.generateLink for Both signup and recovery

The `send-email` Edge Function SHALL call `supabaseAdmin.auth.admin.generateLink(...)` for every flow that produces a user-facing URL (signup confirmation, password recovery). The existing server-side recovery link generation SHALL be retained and the signup flow SHALL be updated to match that same pattern.

#### Scenario: Signup confirmation email contains a server-generated link

- GIVEN `send-email` is deployed and `admin.generateLink` is extended to the signup flow
- WHEN a new user registers and triggers the signup confirmation email
- THEN the received email MUST contain a confirmation link whose origin is either the Supabase Auth domain or `https://www.findmynest.co.nz` (as configured in `admin.generateLink` options) — never an arbitrary client-supplied URL
- Evidence: test inbox screenshot of the signup confirmation email with the link URL visible; attached to `verify-report.md`.

#### Scenario: Recovery email flow is not regressed

- GIVEN the existing server-side recovery link generation (already in place)
- WHEN a user requests a password reset
- THEN the received email MUST contain a server-generated recovery link — behavior MUST be identical to pre-change recovery emails
- Evidence: test inbox screenshot of the recovery email; DevTools Network screenshot showing the `send-email` call returning `200`; attached to `verify-report.md`.

---

### Requirement: send-email MUST Remain Pre-Auth (No verify_jwt Added)

`send-email` SHALL NOT require an `Authorization` header or enable `verify_jwt`. Signup and recovery flows occur before the user has a session; adding a JWT requirement would break these flows entirely. Rate-limiting for `send-email` SHALL be delegated entirely to Supabase Auth's native rate-limiting — no custom rate-limit infrastructure SHALL be added.

#### Scenario: Pre-auth send-email call succeeds without Authorization header

- GIVEN `send-email` is deployed
- WHEN the client calls `send-email` as part of the signup flow WITHOUT an `Authorization` header (the current client behavior at L2553)
- THEN the function MUST accept the request and process it (return 200 on success, or an appropriate domain error) — NOT reject with 401
- Evidence: DevTools Network screenshot of the in-app signup flow showing the `send-email` call returning `200`; attached to `verify-report.md`.

## Non-Goals

- Adding JWT / `verify_jwt` to `send-email` (pre-auth by design; constraint explicitly excludes it).
- Custom rate-limiting on `send-email` (rely on Supabase Auth's native limiter; no new rate-limit infra allowed).
- Controlling which recipient addresses `send-email` can reach (out of scope for this change; future policy consideration).
- Tightening the `to` / `subject` fields beyond discarding `confirmationUrl` (minimal-change principle).

## Open Questions

None for this capability. The recovery flow already uses `admin.generateLink`; extending it to signup is a clear and unambiguous replication of the existing pattern.
