# Tasks: security-hardening-phase-0

## Scope
Battles 1-3 (XSS, token storage, CSP). Battle 4 (`edge-fn-client-auth`) is deferred — see `## Deferred` at the bottom.

Target file is single-page SPA `index.html` (~5000 lines). Existing `esc()` helper at `index.html:1925`. CSP lives in `vercel.json:8`. Inline scripts: `index.html:1916` (main app) and `index.html:4941` (DOM init). JSON-LD at `index.html:33` is non-executable.

---

## Phase A — Audit & Setup (~1-2 hours)

- [x] A.1 Confirm baseline counts and save to working notes: `rg -c "innerHTML\s*=" index.html` (expect 64), `rg -c "on(click|submit|change|load|input|keydown|keyup|mouseover|mouseout|focus|blur)=" index.html` (expect 100), `rg -nc "localStorage\.setItem\(.*(access_token|refresh_token|sb_session|fmn_reset_token)" index.html` (expect 4 at L2191, L2204, L2215, L3795).
- [x] A.2 Create a branch from `main` (per repo convention) and confirm clean working tree with `git status`.
- [x] A.3 Read existing `esc()` helper at `index.html:1925` to confirm signature and behavior; no edit needed.

---

## Phase B — Battle 1: client-xss-defense (~4-6 hours)

### B.1 Centralize sanitization helpers
- [x] B.1.1 In the main script block (after `esc()` at `index.html:1925`), add comment-banner `// === XSS DEFENSE === keep all DOM-write helpers here`.
- [x] B.1.2 Add a small helper `function safeImg(url){ var i=document.createElement('img'); i.src=String(url||''); return i; }` so attribute interpolation paths can avoid `innerHTML`.

### B.2 Convert highest-risk paths to DOM API (ADR-1 item 2)
- [x] B.2.1 Convert `rent-estimate` insight render around `index.html:4599-4620` (the `insight` field): replace `innerHTML = '...${data.insight}...'` with `createElement` + `textContent` for the insight body. Keep structural markup as static `innerHTML`.
- [x] B.2.2 Convert `flatmate-match` result render around `index.html:4682-4720`: build result card via `createElement` + `textContent` per field; do NOT inline the raw response.
- [x] B.2.3 Convert any `<img src="${photo_url}">` interpolation in listing renders (search: `rg -n 'img[^>]*src="\$\{' index.html`) to `setAttribute('src', url)` via `safeImg(url)`. Verify with `rg -n 'img[^>]*src="\$\{' index.html` returning 0.

### B.3 Enforce `esc()` on remaining `innerHTML` interpolations
- [x] B.3.1 Run `rg -n "innerHTML\s*=" index.html` and walk each hit. For each that contains `${...}`, confirm every interpolated value is wrapped in `esc(...)`. Wrap any unescaped value.
- [x] B.3.2 Pay special attention to dynamic `onclick=` strings built inside template literals (e.g. `index.html:2783` `openEditListing(\x27'+l.id+'\x27)`): leave these for Phase D (handler migration) — do NOT just `esc()` them, they are removed entirely later.
- [x] B.3.3 Add a project-standards code comment near `esc()`: `// RULE: no innerHTML with ${...} unless every interpolated value is esc()'d.`

### B.4 Battle 1 verification
- [x] B.4.1 Static audit: `rg -n "innerHTML\s*=" index.html` — every interpolation hit is `esc()`-wrapped OR documented as static. `rg -n 'img[^>]*src="\$\{' index.html` returns 0.
- [ ] B.4.2 Manual smoke per `client-xss-defense/spec.md` scenarios:
  - Listing fixture with title `<img src=x onerror=alert('xss')>` renders as escaped text, no alert.
  - Enquiry message with `<script>alert(1)</script>` renders escaped, no alert.
  - Edge function `insight` containing `<iframe src=javascript:...>` renders as escaped text, no iframe element in DOM tree.
  - `photo_url` containing `" onerror="alert(1)` does not fire `onerror`.
- [x] B.4.3 Commit: `security: harden DOM XSS via centralized sanitization`

---

## Phase C — Battle 2: auth-token-storage (~3-4 hours)

### C.1 Add `sbSession` wrapper with read-fallback (one-release migration)
- [x] C.1.1 In `index.html` near the auth helpers (around L2180), add the `sbSession` object exactly per `design.md` Interfaces section: `get()` reads `sessionStorage` first, falls back to `localStorage` (copy across and delete legacy); `set()` writes only to `sessionStorage`; `clear()` removes from BOTH.
- [x] C.1.2 Add in-memory recovery-token helpers: `var __recoveryToken = null; setRecoveryToken(t); getRecoveryToken(); clearRecoveryToken();` per design Interfaces.
- [x] C.1.3 Add code comment near `sbSession`: `// fmn_u (non-sensitive profile blob) stays in localStorage — it does not contain access_token / refresh_token.`

### C.2 Replace `sessionStorage`/`localStorage` reads with wrapper
- [x] C.2.1 Update `index.html:2180` and `index.html:2219` (and `:2226` if applicable) reads to call `sbSession.get()` instead of direct `localStorage.getItem('sb_session')`.
- [x] C.2.2 Confirm token-refresh path at `index.html:2186` calls `sbSession.set(blob)` on every successful refresh (rotation: full replace, no append).

### C.3 Remove `localStorage` write path for tokens
- [x] C.3.1 Replace `localStorage.setItem('sb_session', JSON.stringify(s))` at `index.html:2191` with `sbSession.set(s)`.
- [x] C.3.2 Replace `localStorage.setItem('sb_session', JSON.stringify(d))` at `index.html:2204` with `sbSession.set(d)`.
- [x] C.3.3 Replace `localStorage.setItem('sb_session', JSON.stringify(d))` at `index.html:2215` with `sbSession.set(d)`.
- [x] C.3.4 Replace `localStorage.setItem('fmn_reset_token', params.access_token)` at `index.html:3795` with `setRecoveryToken(params.access_token)`.
- [x] C.3.5 Replace the corresponding recovery-token read at `index.html:2340` (and any other read sites — confirm with `rg -n "fmn_reset_token" index.html`) with `getRecoveryToken()`.
- [x] C.3.6 In the logout path, call `sbSession.clear()` and `clearRecoveryToken()`; confirm no remaining `localStorage.removeItem('sb_session')` calls drift out of the wrapper.

### C.4 Battle 2 verification
- [x] C.4.1 Static audit: `rg -n "localStorage\.setItem\(.*(access_token|refresh_token|sb_session|recovery|fmn_reset_token)" index.html` returns 0.
- [ ] C.4.2 Manual smoke per `auth-token-storage/spec.md`:
  - Fresh profile: login → DevTools Application shows `sessionStorage.sb_session` present, `localStorage` has NO `sb_session`/`access_token`/`refresh_token`/`recovery` key.
  - Token-refresh: trigger refresh, confirm `localStorage` unchanged for auth keys before/after.
  - Logout: both stores cleared of auth keys; subsequent authed call returns 401 / UI logged-out.
  - Same-tab reload: still logged in. New tab / browser restart: logged out.
  - Migration: pre-seed `localStorage['sb_session']` with a valid blob, reload, confirm it moves to `sessionStorage` and is removed from `localStorage` without re-login prompt.
  - DevTools Console: `Object.keys(localStorage).filter(k=>/access_token|refresh_token|sb_session|recovery/i.test(k))` returns `[]`.
- [x] C.4.3 Commit: `security: migrate auth tokens to sessionStorage`

---

## Phase D — Battle 3a: inline handler migration (~4-6 hours per group)

### D.0 Foundation: dispatcher + ACTIONS map
- [x] D.0.1 In the main script block, add the `ACTIONS` registry and the two delegated listeners (`click`, `submit`) exactly per `design.md` ADR-5 dispatcher pseudocode. Keep `ACTIONS` an explicit map (no `window[name]` lookup).
- [x] D.0.2 Add an init point so dispatcher binds once after `DOMContentLoaded`; verify no double-binding.

### D.1 Auth group — login / signup / logout / forgot / reset (~15 handlers)
- [x] D.1.1 Identify auth handlers: `rg -n "on(click|submit|change)=" index.html | rg -i "auth|login|signup|logout|forgot|reset"`.
- [x] D.1.2 Convert each static handler to `data-action="<name>"` and add the corresponding entry to `ACTIONS`. Convert form handlers to `data-action` on the `<form>` (submit dispatcher).
- [ ] D.1.3 Smoke walk: open login form, submit; signup form, submit; logout button; forgot-password flow; reset flow. All work; DevTools Console clean.
- [x] D.1.4 Commit: `security: migrate auth inline handlers to data-action dispatcher`

### D.2 Landlord listings CRUD group (~25 handlers)
- [x] D.2.1 Identify CRUD handlers including dynamic ones built in template literals (around `index.html:2783` `openEditListing`, `doRemove`, `viewListing`, etc.).
- [x] D.2.2 Replace dynamic `onclick="openEditListing('${l.id}')"` patterns with `data-action="openEditListing" data-id="${esc(l.id)}"`. Add corresponding `ACTIONS.openEditListing = function(el){ openEditListing(el.dataset.id); }`.
- [x] D.2.3 For complex closures (file uploaders / photo gallery), use direct `addEventListener` after element creation rather than delegation.
- [ ] D.2.4 Smoke: add listing, edit listing, delete listing, upload photo, navigate photos. All work; Console clean.
- [x] D.2.5 Commit: `security: migrate landlord listings inline handlers`

### D.3 Renter dashboard nav + listing cards group (~25 handlers)
- [x] D.3.1 Identify renter-side handlers: dashboard nav tabs, listing-card clicks, "view details".
- [x] D.3.2 Convert to `data-action` + `ACTIONS` entries. Tab switching keeps current URL-hash behavior if present.
- [ ] D.3.3 Smoke: each nav tab switches, listing cards open detail, console clean.
- [x] D.3.4 Commit: `security(csp): migrate renter dashboard inline handlers`

### D.4 Enquiry flow group (~15 handlers)
- [x] D.4.1 Identify enquiry handlers (open enquiry, submit enquiry form, landlord reply, close).
- [x] D.4.2 Convert handlers; the enquiry render path also produced inline handlers inside template strings — kill those via `data-action` + `data-*` dataset attributes.
- [ ] D.4.3 Smoke: renter opens enquiry on a listing, submits; landlord views enquiry, replies. Console clean.
- [x] D.4.4 Commit: `security(csp): migrate enquiry inline handlers`

### D.5 AI panels + modals group (~20 handlers)
- [x] D.5.1 Identify handlers for rent-estimate panel, flatmate-match panel, modal close buttons, AI listing generation buttons.
- [x] D.5.2 Convert handlers; for any in-template `onclick`, replace with `data-action`.
- [ ] D.5.3 Smoke: open rent-estimate, run estimate, close. Open flatmate-match, run, close. Open any other modal, close. Console clean.
- [x] D.5.4 Commit: `security: migrate AI panels and modals inline handlers`

### D.5.x Photo gallery refactor (D.2.3 follow-up)
- [x] D.5.x.1 Migrate 4 static photo-upload-area divs to data-action="triggerFileInput"
- [x] D.5.x.2 Migrate renderPhotoGrid removePhoto + add-slot to data-action
- [x] D.5.x.3 Migrate renderListingPhotos switchPhoto thumbnails to data-action="switchPhoto" data-url
- [x] D.5.x.4 Fix switchPhoto() — replace querySelectorAll('[onclick*="switchPhoto"]') with querySelectorAll('[data-action="switchPhoto"]')
- [x] D.5.x.5 Migrate renderEditCurrentPhotos / renderEditCurrentPhotosFromData / renderEditNewGrid to data-action
- [ ] D.5.x.6 Smoke: photo gallery navigation, add/remove photos in edit modal. Console clean.

### D.6 Phase D verification (gates Phase E)
- [x] D.6.1 `rg -c "on(click|submit|change|load|input|keydown|keyup|mouseover|mouseout|focus|blur)=" index.html` MUST return 0. (Result: 1 match — JS property assignment `hcbtn.onclick=function`, not an HTML attribute — confirmed exempt)
- [ ] D.6.2 Full smoke walk: home → signup → login → renter dashboard tabs → listing card → enquiry → landlord dashboard → listing CRUD → AI panels → logout. DevTools Console clean across all steps.

---

## Phase E — Battle 3b: CSP strict (~1-2 hours)

### E.1 Extract SHA-256 hashes for the two inline `<script>` blocks
- [ ] E.1.1 Identify start and end line numbers for the main inline script (begins at `index.html:1916`, ends just before the next non-script line) and the DOM init script (around `index.html:4941`). JSON-LD at `index.html:33` is exempt (non-executable).
- [ ] E.1.2 Extract block bodies (between `<script>` and `</script>`, NOT including the tags themselves per CSP spec) into temp files. Compute hashes: `openssl dgst -sha256 -binary <tempfile> | openssl base64 -A`. Record output as `sha256-<value>`.
- [ ] E.1.3 Document the exact one-liner used in commit body so re-hashing is reproducible.

### E.2 Update `vercel.json` CSP
- [ ] E.2.1 In `vercel.json:8` replace `script-src 'self' 'unsafe-inline'` with `script-src 'self' 'sha256-<hash1>' 'sha256-<hash2>'`. Keep all other directives (`default-src`, `style-src`, `font-src`, `img-src`, `connect-src`, `frame-ancestors`, `base-uri`, `form-action`) byte-for-byte unchanged.
- [ ] E.2.2 Confirm `'unsafe-eval'` is NOT present anywhere in `script-src`.

### E.3 Verification
- [ ] E.3.1 Deploy to Vercel preview. Open preview URL in fresh browser profile (cache disabled). Verify NO CSP violation messages in DevTools Console during the full smoke walk (home → signup → login → dashboards → enquiry → AI panels → logout).
- [ ] E.3.2 Run `curl -sI https://<preview-url>/ | rg -i "content-security-policy"` — output MUST show `script-src 'self' 'sha256-...' 'sha256-...'` with NO `'unsafe-inline'` and NO `'unsafe-eval'`.
- [ ] E.3.3 Static audit re-run: `rg -c "on(click|submit|change|load|input|keydown|keyup|mouseover|mouseout|focus|blur)=" index.html` returns 0 (regression check).
- [ ] E.3.4 Commit: `security: strict CSP with SHA-256 inline script hashes`

---

## Phase F — Cleanup & PR (~1 hour)

- [ ] F.1 Update / create `openspec/changes/security-hardening-phase-0/verify-report.md` with evidence per scenario (screenshots, `rg` outputs, `curl -I` dumps) — `sdd-verify` may produce this; this task just confirms it is filled in before PR.
- [ ] F.2 Open PR titled `security: harden phase 0 (XSS, token storage, CSP)` with body that includes:
  - Checklist linking each commit to the spec scenarios it satisfies.
  - Link to `verify-report.md`.
  - Note that Battle 4 is deferred to a follow-up change.
- [ ] F.3 (Out-of-PR, ≥1 release later) Remove the `localStorage` read-fallback from `sbSession.get()` and the `localStorage.removeItem('sb_session')` belt-and-suspenders in `clear()`. Ship as a separate commit `security: remove sbSession localStorage fallback after migration window`.

---

## Deferred (out of scope for this change)

### Battle 4: edge-fn-client-auth

Spec exists at `openspec/changes/security-hardening-phase-0/specs/edge-fn-client-auth/spec.md` and stays in this change directory for traceability. To be shipped as a follow-up change `security-hardening-phase-1-edge-auth` once server-side Edge Function code can be coordinated. Includes:

- Add `Authorization: Bearer <jwt>` to authenticated calls: `send-email` (`index.html:2382`), `submit-enquiry` (`index.html:3123`), `flatmate-match` (`index.html:4682`), `ai-listing` (`index.html:4454`, `index.html:4506`). `rent-estimate` (`index.html:4587`) stays public.
- Introduce `callEdge(name, body, {auth})` helper per `design.md` ADR-4; centralize JWT attachment via live `sbAuth('GET_SESSION')`.
- Stop trusting client-supplied identity fields — remove `renter_id`, `landlord_id`, `user_id`, caller `email` from request bodies; server derives via `auth.uid()`.
- Coordinate server-side JWT validation in Supabase Edge Functions BEFORE client ship (server-first rollout per design Cross-System Coordination).
- Handle `flatmate_profiles` missing-row UX ("Complete your profile" path).

**Rationale.** User does not currently have access to Supabase Edge Function server code. Shipping client-side `Authorization: Bearer` without coordinated server-side enforcement is worst-of-both-worlds: breaks the flow if the server later enforces, and adds no real security if the server never enforces.
