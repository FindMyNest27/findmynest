# client-xss-defense Specification

## Purpose

Prevent DOM-based XSS in the FindMyNest SPA by ensuring every DOM write that incorporates non-static data (Supabase records, user input, AI output, URL fragments) is either escaped via the existing `esc()` helper or routed through safe DOM APIs that never parse HTML.

## Requirements

### Requirement: Dynamic DOM Writes MUST Be Sanitized

Any assignment to `.innerHTML`, `.outerHTML`, `insertAdjacentHTML(...)`, or `document.write(...)` whose value is composed (in whole or in part) from non-static data SHALL pass that data through `esc()` before interpolation. Implementations MAY instead replace the call with `textContent`, `createElement` + `appendChild`, or `setAttribute` — these are considered automatically safe for text content.

#### Scenario: Listing details render without script execution

- GIVEN a listing whose `title` field is stored as `"<img src=x onerror=alert('xss')>"`
- WHEN the renter dashboard renders that listing card
- THEN the literal text MUST appear inside the card and no `alert` dialog MUST fire
- Evidence: in DevTools Console, run the listing render path with that fixture title; capture screenshot showing escaped text in DOM and clean Console (no alert, no `[CSP]` violations).

#### Scenario: User-provided enquiry message renders as text

- GIVEN a landlord viewing an enquiry where the renter's `message` body contains `<script>alert(1)</script>`
- WHEN the enquiry detail panel renders
- THEN the `<script>` MUST appear as escaped text (visible angle brackets) and MUST NOT execute
- Evidence: DevTools Elements panel screenshot showing `&lt;script&gt;...` in DOM; Console screenshot with no alert.

#### Scenario: AI-generated content (rent estimate / flatmate match) renders safely

- GIVEN an Edge Function response whose `result` field contains an HTML payload `<iframe src=javascript:...></iframe>`
- WHEN the result is rendered into the AI output card
- THEN the iframe MUST appear as escaped text or MUST NOT be inserted into the DOM as an element
- Evidence: DevTools Elements screenshot — no `<iframe>` element is present in the rendered card subtree.

#### Scenario: URL / attribute values are escaped before being interpolated

- GIVEN a listing whose `photo_url` field contains `" onerror="alert(1)`
- WHEN the listing card builds an `<img>` via template-string interpolation
- THEN the attribute MUST be quoted AND its value MUST pass through `esc()`, breaking the injection
- Evidence: DevTools Elements screenshot showing the literal escaped string in the `src` attribute and no firing of `onerror`.

#### Scenario: Static template literals are not required to use esc

- GIVEN a code path that builds HTML purely from string literals (no interpolation of variables)
- WHEN that HTML is assigned via `innerHTML`
- THEN `esc()` is NOT required for that assignment
- Evidence: `rg "innerHTML\s*=" index.html` output annotated to confirm each remaining hit either has no interpolation OR every interpolated value is wrapped in `esc(...)`.

## Non-Goals

- Refactoring all `innerHTML` usage away from the codebase. If the data path is safe (static or `esc()`-wrapped), the call remains.
- Introducing a templating library, DOMPurify, or a build system.
- Server-side sanitization in Supabase (separate concern; database stores raw values).
- Trusted Types policy enforcement (future hardening).

## Open Questions

- (none — proposal and existing `esc()` cover the data path; deferred decisions belong to design phase only if a sink cannot be covered by `esc()`.)
