# csp-strict Specification

## Purpose

Enforce a Content-Security-Policy strict enough to break the common XSS-execution paths (inline `<script>` blocks, `onclick=` handlers, `javascript:` URLs) while preserving all current FindMyNest features (login, listing CRUD, navigation, AI panels).

## Requirements

### Requirement: script-src MUST NOT Include 'unsafe-inline'

The HTTP response header `Content-Security-Policy` returned by the Vercel deployment SHALL define a `script-src` directive that does NOT include the token `'unsafe-inline'`. The directive MAY include `'self'` and any explicit allowlisted origins. The directive MUST NOT include `'unsafe-eval'`.

#### Scenario: Production response headers do not allow inline scripts

- GIVEN the production (or preview) Vercel deployment is live
- WHEN an operator runs `curl -sI https://<deploy>/ | rg -i "content-security-policy"`
- THEN the output MUST contain a `script-src` directive AND MUST NOT contain the substring `'unsafe-inline'` within `script-src` AND MUST NOT contain `'unsafe-eval'`
- Evidence: terminal screenshot or copy of the `curl -I` output attached to `verify-report.md`.

### Requirement: All Event Wiring MUST Use addEventListener

The file `index.html` SHALL NOT contain inline event-handler attributes (`onclick=`, `onsubmit=`, `onchange=`, `onload=`, `oninput=`, `onkeydown=`, `onkeyup=`, `onsubmit=`, `onmouseover=`, etc.) on any HTML element. All interactive wiring SHALL be done via `addEventListener` calls in script blocks loaded from `'self'`.

#### Scenario: Static audit finds no inline handlers

- GIVEN the codebase at the post-change commit
- WHEN an operator runs `rg "on(click|submit|change|load|input|keydown|keyup|mouseover|mouseout|focus|blur)=" index.html`
- THEN the command MUST return 0 hits
- Evidence: terminal screenshot of the `rg` output attached to `verify-report.md`.

### Requirement: Every Interactive Element MUST Remain Functional

After the CSP tightening and the handler migration, every previously functional interactive control SHALL continue to function without CSP violations in the browser console.

#### Scenario: Page loads with zero CSP violations

- GIVEN the production (or preview) build is loaded in a fresh browser profile
- WHEN the user navigates to `/`, signs up, logs in, opens the renter dashboard, opens the landlord dashboard, opens an AI panel
- THEN the DevTools Console MUST NOT show any message containing `Content Security Policy` or `Refused to execute inline script` or `Refused to apply inline style`
- Evidence: DevTools Console screenshot post-walkthrough attached to `verify-report.md`.

#### Scenario: Login form submit works after handler migration

- GIVEN the login form previously bound via inline `onsubmit=`
- WHEN the user fills credentials and clicks "Log in"
- THEN the form MUST submit, the authenticated state MUST be reached, AND no CSP violation MUST appear in the console
- Evidence: DevTools Network screenshot showing the `token` request returning `200`, Console screenshot clean.

#### Scenario: Listing add / edit / delete buttons work after handler migration

- GIVEN a landlord on the dashboard with an existing listing
- WHEN they click "Add listing", "Edit", and "Delete" buttons previously bound via inline `onclick=`
- THEN each action MUST execute the expected mutation AND no CSP violation MUST appear in the console
- Evidence: DevTools Network screenshot for each operation showing the Supabase request firing; Console clean.

#### Scenario: Navigation tabs switch views after handler migration

- GIVEN the renter dashboard with sidebar/tab navigation previously bound via inline `onclick=`
- WHEN the user clicks each navigation tab
- THEN each click MUST switch the active panel AND the URL hash (if used) MUST update AND no CSP violation MUST appear in the console
- Evidence: video or sequential screenshots covering each tab switch; Console clean throughout.

## Non-Goals

- Strict-dynamic / nonce / hash-based CSP (future iteration).
- Tightening `style-src`, `connect-src`, `font-src`, or `img-src` beyond their current state. Only `script-src` changes here.
- Subresource Integrity for first-party scripts.
- Reporting endpoint (`report-uri` / `report-to`).

## Open Questions

- Should we keep the existing CSP directives for `connect-src`/`font-src`/`style-src` byte-for-byte, or take this opportunity to also remove unused origins? — Default: keep them untouched to minimize regression risk; design phase confirms.
- Do any third-party widgets (Formspree, fonts) require additions to `script-src`? — Default: no; current usage is fetch-only (covered by `connect-src`). Design phase verifies via `rg` of script origins.
