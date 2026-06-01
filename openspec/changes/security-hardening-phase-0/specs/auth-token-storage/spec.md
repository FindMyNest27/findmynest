# auth-token-storage Specification

## Purpose

Keep Supabase auth material (`access_token`, `refresh_token`, password recovery tokens) out of `window.localStorage` so that a successful XSS or third-party script compromise cannot trivially exfiltrate a long-lived session by reading from `localStorage`.

## Requirements

### Requirement: Auth Tokens MUST NOT Be Persisted in localStorage

The client SHALL NOT call `localStorage.setItem(...)` with a key or value that contains an `access_token`, `refresh_token`, full Supabase session blob (`sb-*-auth-token`, `sb_session`), or password recovery token. The client SHALL NOT depend on any such pre-existing `localStorage` entry for auth state.

Allowed storage destinations are decided by `sdd-design` (e.g., in-memory variable, `sessionStorage`, `httpOnly` cookie issued by a server). The spec only enforces the prohibition and the observable behaviors below.

#### Scenario: Login does not write tokens to localStorage

- GIVEN a fresh browser profile with empty `localStorage`
- WHEN the user logs in successfully via the email/password form
- THEN no `localStorage` key whose name or value contains `access_token`, `refresh_token`, `sb-*-auth-token`, `sb_session`, or `recovery` SHALL be present
- Evidence: DevTools Application > Local Storage screenshot post-login showing the absence of those keys; `rg "localStorage\.setItem\(.*(access_token|refresh_token|sb_session|recovery)" index.html` returns 0 hits.

#### Scenario: Session refresh does not leak tokens to localStorage

- GIVEN a logged-in session approaching token expiry
- WHEN the client refreshes the access token (manually or automatically)
- THEN the refreshed `access_token` MUST NOT be written to `localStorage`
- Evidence: DevTools Application panel screenshot before and after refresh showing `localStorage` unchanged for auth keys.

#### Scenario: Logout clears any in-memory or sessionStorage auth state

- GIVEN a logged-in user
- WHEN the user clicks "Log out"
- THEN subsequent authenticated calls MUST receive `401`, the UI MUST return to the logged-out state, AND no auth token (in any storage) MUST remain readable to JavaScript
- Evidence: DevTools Application screenshot showing both `localStorage` and `sessionStorage` cleared of auth keys; Network panel showing a subsequent Edge Function call returning `401`.

#### Scenario: Hard reload behavior is explicitly defined

- GIVEN a logged-in user
- WHEN the user triggers a hard reload (Cmd/Ctrl + Shift + R)
- THEN the post-reload behavior MUST match the choice resolved in design (either "user is logged out" OR "session restored via a non-`localStorage` mechanism")
- Evidence: screenshot of post-reload state matching the documented expectation in `design.md`.

#### Scenario: XSS payload cannot read tokens via localStorage.getItem

- GIVEN a malicious script executes in the page context (simulate by running in DevTools Console)
- WHEN it runs `Object.keys(localStorage).filter(k => /access_token|refresh_token|sb_session|recovery/i.test(k))`
- THEN the returned array MUST be empty AND `localStorage.getItem` for any well-known Supabase auth key MUST return `null`
- Evidence: DevTools Console screenshot showing `[]` and `null` outputs while user is logged in.

## Non-Goals

- Defending against XSS itself (covered by `client-xss-defense`).
- Server-side refresh token rotation policy.
- Multi-tab session synchronization guarantees (best-effort).
- Replacing Supabase Auth with a custom auth server.

## Open Questions

- Persist session across hard reload? Two design options to resolve in `sdd-design`:
  - **Option A: In-memory only** — tokens live in a JS variable; hard reload returns the user to the login screen. Strongest XSS resistance, slight UX regression.
  - **Option B: `sessionStorage`** — tokens survive same-tab reload but not new-tab/new-window. Still JS-readable, but no longer persistent across browser restart and not shared with other tabs.
  - **Option C: Server-issued `httpOnly` cookie** — strongest, but requires a server hop (currently no first-party server beyond Edge Functions); design must confirm feasibility.
- How to call Edge Functions when access token lives in a non-JS-readable cookie (cookie-mode would force a same-origin proxy or `credentials: 'include'` with CORS allowlist).
