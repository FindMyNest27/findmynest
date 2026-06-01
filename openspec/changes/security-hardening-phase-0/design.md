# Design: Security Hardening — Phase 0

## Technical Approach

Single-file SPA constraint dominates everything: `index.html` is ~5000 lines of inline HTML+JS+CSS, no bundler, no test runner. The four battles ship as sequenced commits on one PR, each verifiable with `rg` + DevTools + `curl -I`. We add no new tooling, no new files (with the optional exception of one tiny external `app.js` shim discussed in ADR-3 if hashes prove unmanageable). All work reuses the existing `esc()` helper at `index.html:1925`.

The pre-resolved decisions (see proposal addendum) anchor the design:
- Token storage → `sessionStorage` with rotation.
- Edge fn classification → `send-email`, `submit-enquiry`, `flatmate-match` private; `rent-estimate` public.
- No anonymous enquiry / send-email.
- CSP scope → `script-src` only; other directives byte-for-byte unchanged.

## Architecture Decisions

### ADR-1: Sanitization Strategy — Hybrid (`esc()` everywhere + DOM API for highest-risk paths)

**Context.** 64 `innerHTML` writes in `index.html`; existing `esc()` at L1925 already wraps most template-literal interpolations. Risky sinks are the AI Edge Function outputs (`rent-estimate.insight` rendered raw at L4608; `flatmate-match` similar), attribute interpolation (`photo_url` in `<img src="..."`), and any path that builds inline `onclick=` strings inside the template (e.g. L2783 `onclick="openEditListing(\x27'+l.id+'\x27)"`).

**Choice.** Hybrid policy:
1. Keep template-driven renders that already use `esc()` and `innerHTML` — they're safe.
2. Convert these specific paths to DOM API (`createElement` + `textContent` + `setAttribute`):
   - `rent-estimate` `insight` rendering (`index.html:4608`).
   - `flatmate-match` result rendering (around `index.html:4682-4720`).
   - Any `<img src="${photo_url}">` interpolation — switch to `img.src = url; img.onerror = null;` after URL validation.
3. Enforce `esc()` on **every** remaining `innerHTML` interpolation. Add a `## Project Standards` rule: "no `innerHTML` with `${...}` unless every interpolated value is wrapped in `esc(...)`."

**Alternatives rejected.**
| Option | Why rejected |
|--------|--------------|
| Full conversion to DOM API | Touches 64 sites; high regression risk on a single-file SPA without tests. |
| Introduce DOMPurify | New dependency, violates "no new tooling" constraint, CSP would need to allowlist it. |
| Trusted Types policy | Not supported in all NZ-market browsers (Safari); future hardening. |

**Consequences.** Surface area minimized; existing template style preserved; highest-risk sinks (untrusted Edge Function output + attribute injection) get the strongest defense. Residual risk: developer must remember to `esc()` on new code — mitigated by the project-standards rule and the manual checklist.

**Manual verification.**
- `rg "innerHTML\s*=" index.html` → every hit either has no interpolation OR every `${...}` is `esc(...)`.
- DevTools: render fixtures from the four `client-xss-defense` scenarios; no alert fires.

---

### ADR-2: Token Storage Migration — `sessionStorage` with One-Release Read-Fallback

**Context.** Current code writes `sb_session` to `localStorage` at L2191, L2204, L2215; reads at L2180, L2219. There's also `fmn_u` (user profile blob — non-sensitive, name/email/phone), `fmn_reset_token` (password recovery token — sensitive), `fmn_u.photo_url` updates.

**Decision (already made).** `sessionStorage` with rotation. Clear on tab close; persist on same-tab reload.

**Migration sequence (to avoid logging users out mid-deploy):**
1. **Battle 2 commit** introduces a `sbSession.get()` / `sbSession.set()` / `sbSession.clear()` wrapper. `set()` writes to `sessionStorage` only. `get()` reads `sessionStorage` first, then falls back to `localStorage` (one-time migration: if found in `localStorage`, copy to `sessionStorage` and delete from `localStorage`). `clear()` removes from BOTH.
2. **Recovery token (`fmn_reset_token`)** moves to in-memory only (a module-level `var`). Recovery flow happens within a single page session, so no persistence needed. Remove `localStorage.setItem('fmn_reset_token', …)` at L3795 and the corresponding read at L2340.
3. **`fmn_u` (non-sensitive profile blob)** stays in `localStorage`. It does not contain `access_token` / `refresh_token`. Document this explicitly in code comment so future audits don't churn on it.
4. **Cleanup commit (1 release later)** removes the `localStorage` read-fallback in `get()` and the migration copy logic. By then all active sessions have rotated.

**Rotation.** On every successful `/auth/v1/token?grant_type=refresh_token` response (L2186), `sbSession.set()` replaces the stored blob entirely — old `access_token` and `refresh_token` are overwritten in `sessionStorage`. No append, no diff.

**Alternatives rejected.**
| Option | Why rejected |
|--------|--------------|
| In-memory only (Option A in spec) | Hard reload logs user out; UX regression unacceptable for daily use. |
| `httpOnly` cookie (Option C in spec) | Requires a first-party server (we only have Edge Functions); CORS + `credentials: 'include'` would force a same-origin proxy. Defer. |
| Big-bang switch (no read-fallback) | Every active user logged out on deploy day — avoidable UX cliff. |

**Consequences.** Tokens unreadable from a new tab or after browser restart (good). Still JS-readable within the same tab — strict CSP (ADR-3) is the second line of defense. Residual risk: XSS within the same tab can still read `sessionStorage`. Mitigated by ADR-1 + ADR-3.

**Manual verification.**
- `rg "localStorage\.setItem\(.*(access_token|refresh_token|sb_session|recovery)" index.html` → 0 hits after Battle 2.
- DevTools Application panel: pre-login state empty; post-login `sessionStorage` has `sb_session`, `localStorage` does not.
- Reload tab → still logged in. Close tab + reopen → logged out.

---

### ADR-3: CSP — SHA-256 Hash for the Two Inline `<script>` Blocks

**Context.** `index.html` has three `<script>` elements: L33 (JSON-LD structured data, `type="application/ld+json"` — not executable, CSP does not restrict it), L1916 (main app, ~3000 lines of inline JS), L4941 (DOM init block, small). The JSON-LD block is exempt. The two real inline scripts need a CSP-compatible execution path.

**Choice.** SHA-256 hash for the two inline blocks. Compute the hash of each block's exact byte content; include both in `script-src` as `'sha256-<hash>'`. `vercel.json` ships the static value.

**Alternatives rejected.**
| Option | Tradeoff |
|--------|----------|
| Move all inline JS to external `app.js` | Cleanest CSP (`script-src 'self'`), but breaks single-file deploy and the no-build constraint. Migration touches ~3000 lines and reorders DOMContentLoaded order. Defer as ADR-3-future. |
| Per-deploy nonce | Vercel static hosting cannot inject per-response nonces without an edge middleware. Adds infra. Defer. |
| Keep `'unsafe-inline'` with hash fallback | Defeats the entire point of Battle 3. Rejected. |

**Consequences.** Any change to either inline block (a single whitespace edit) invalidates its hash and breaks the page on deploy. We mitigate with two safeguards: (a) a pre-deploy script (manual: a `make hash` or a one-liner in the verification checklist) re-computes both hashes; (b) Vercel's instant-rollback covers a deploy-time miss. Residual risk: hash drift between editor and deployed file (line-ending normalization). Document the exact hash command in the task: `openssl dgst -sha256 -binary <(rg -nP --no-line-number '...' )` — design phase calls out that we'll specify the exact command in tasks.md.

**Inline handler migration pattern (gates ADR-3 from landing).** Battle 3a (separate from 3b) migrates all 100 inline handler attributes (`rg -c "onclick=|onsubmit=…"` = 100 in `index.html`) to `addEventListener`. We use **data-action attributes + event delegation** on `document` for click/submit handlers that take simple arguments, and **direct `addEventListener` per element** for ones with complex closures (file uploaders, photo galleries). Migration grouped into 5 feature-group commits:
1. Auth (signup/login/logout/forgot/reset) — ~15 handlers.
2. Landlord listings CRUD (add/edit/delete/photo upload) — ~25 handlers.
3. Renter dashboard (nav tabs, listing cards, view details) — ~25 handlers.
4. Enquiry flow (open, submit, reply) — ~15 handlers.
5. AI panels + modals (rent estimate, flatmate match, close buttons) — ~20 handlers.

**Manual verification.**
- `rg "on(click|submit|change|load|input|keydown|keyup|mouseover|mouseout|focus|blur)=" index.html` → 0 hits after Battle 3a.
- `curl -sI https://<deploy>/ | rg -i "content-security-policy"` → `script-src 'self' 'sha256-...' 'sha256-...'` (no `'unsafe-inline'`, no `'unsafe-eval'`).
- DevTools Console clean across the full smoke walk (home, signup, login, dashboard, all tabs, enquiry, AI panels).

---

### ADR-4: Edge Function Client-Side Contract — `callEdge(name, body, {auth})` Helper

**Context.** Today every Edge Function call is a hand-rolled `fetch` with inconsistent headers. `submit-enquiry` (L3123) and `send-email` (L2382) omit `Authorization` and include client-asserted identity fields (`renter_id: u.auth_id || u.id`, L3128).

**Choice.** Single helper at the top of the main script block:

```js
// Edge Function caller. Centralizes JWT attachment + identity policy.
async function callEdge(name, body, opts) {
  opts = opts || {};
  var headers = {'Content-Type': 'application/json', 'apikey': SB_KEY};
  if (opts.auth) {
    var s = await sbAuth('GET_SESSION');
    if (!s || !s.access_token) throw new Error('Not logged in');
    headers['Authorization'] = 'Bearer ' + s.access_token;
  }
  var res = await fetch(SB_URL + '/functions/v1/' + name, {
    method: 'POST', headers: headers,
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) { var e = await res.text(); throw new Error(e); }
  return res.json();
}
```

**Per-function rewrite (client side):**

| Function | Call site | Auth | Body changes |
|----------|-----------|------|--------------|
| `send-email` | L2382 | `{auth: true}` | Remove `email` arg if server derives recipient from `listing_id` + `auth.uid()`. Keep `type` + `confirmationUrl` for now (transactional template selector). |
| `submit-enquiry` | L3123 | `{auth: true}` | Remove `renter_id`, `renter_name`, `renter_email`, `renter_phone`. Keep `listing_id` + `message`. Server derives identity from JWT. |
| `flatmate-match` | L4682 | `{auth: true}` | Remove any client-sent `renter` field; server derives from JWT + `flatmate_profiles` row. |
| `rent-estimate` | L4587 | `{auth: false}` (PUBLIC) | No auth header. Body unchanged. Server adds rate-limit (out-of-repo). |
| `ai-listing` | L4454, L4506 | **FLAGGED — see Risks** | Not classified in orchestrator decisions; design surfaces as risk. |

**Token freshness.** `callEdge` calls `sbAuth('GET_SESSION')` at request time, which already refreshes if `expires_at` is within 60s (L2184). This satisfies `edge-fn-client-auth` scenario "Token is fetched live, not from a stale cached variable."

**Alternatives rejected.**
| Option | Why rejected |
|--------|--------------|
| Inline `Authorization` in each fetch | Already what we have, prone to drift. |
| Swap `fetch` for `supabase-js` SDK | New dependency; CSP and bundle implications; non-goal per spec. |

**Consequences.** Single sink for auth attachment. Future Edge Functions added with `callEdge(name, body, {auth: true})` are correct by construction. Residual risk: server-side enforcement is out of this change — `send-email` and `submit-enquiry` server code MUST land before or with Battle 4. See Cross-System Coordination.

**Manual verification.**
- `rg "fetch\(.*functions/v1/(send-email|submit-enquiry|flatmate-match)" index.html` → 0 hits (all calls go through `callEdge`).
- DevTools Network: each authenticated call shows `Authorization: Bearer ey...`; payload has no `renter_id` / `user_id` / caller `email`.
- Server returns `401` if `curl` calls `/functions/v1/send-email` without the header (depends on server-side ship).

---

### ADR-5: Inline Handler Migration Pattern — Data-Action + Delegation, Hybrid with Direct Listeners

**Context.** 100 inline handler hits (per `rg -c`). Many are simple (`onclick="openAuth()"`), some carry data (`onclick="openEditListing(\x27'+l.id+'\x27)"`), and some are dynamically generated inside `innerHTML` template strings (the highest-risk subset because they couple ADR-1 and ADR-3).

**Choice.** Hybrid:
1. **Static handlers** in the document body markup (e.g. `<button onclick="openAuth()">`): convert to `data-action="openAuth"` + a single delegated `document.addEventListener('click', ...)` dispatcher.
2. **Dynamic handlers built inside template literals** (e.g. `onclick="openEditListing('${l.id}')"` at L2783): convert to `data-action="openEditListing" data-id="${esc(l.id)}"` + dispatcher reads `dataset`. This kills two birds — removes inline handlers AND eliminates a class of attribute injection.
3. **Complex closures** (file uploaders at `initPhotoUploader`, photo gallery navigation): direct `addEventListener` per element after creation.

**Dispatcher pseudocode:**
```js
var ACTIONS = {
  openAuth: function(el){ openAuth(); },
  openEditListing: function(el){ openEditListing(el.dataset.id); },
  doRemove: function(el){ doRemove(el.dataset.id); },
  viewListing: function(el){ viewListing(el.dataset.id); },
  // ...
};
document.addEventListener('click', function(e){
  var t = e.target.closest('[data-action]');
  if (!t) return;
  var fn = ACTIONS[t.dataset.action];
  if (fn) fn(t);
});
document.addEventListener('submit', function(e){ /* same pattern for forms */ });
```

**Alternatives rejected.**
| Option | Why rejected |
|--------|--------------|
| Direct `addEventListener` per element only | Requires DOM lookups for every dynamically-rendered listing card — extra code, easy to miss after re-renders. |
| Function reference assignment (`btn.onclick = fn`) | Still uses `on*` properties; doesn't compose; CSP doesn't care but style does. |

**Consequences.** Dispatcher is the new central security choke point — anything in `ACTIONS` is callable from any `data-action` attribute on the page. Keep `ACTIONS` keys explicit (no `window[name]` lookup). Residual risk: a `data-action` attribute injected via XSS could trigger any registered action — but this is gated on ADR-1 preventing the injection in the first place.

**Manual verification.**
- `rg "on(click|submit|change|load|input|keydown|keyup|mouseover|mouseout|focus|blur)=" index.html` → 0 hits.
- Smoke walk: every previously-working button/link/form still works; DevTools Console clean (no CSP violations).

---

## Data Flow

### Login → Token Storage → Reload

```
[User] → submit login form
         ↓
[sbAuth('LOGIN')] → POST /auth/v1/token?grant_type=password
         ↓
[Supabase] ← { access_token, refresh_token, expires_at, user }
         ↓
[sbSession.set(blob)] → sessionStorage['sb_session'] = JSON.stringify(blob)
         ↓
[setUser({...non-sensitive...})] → localStorage['fmn_u']
         ↓
[showDashboard()]

Same-tab reload:
[DOMContentLoaded] → sbSession.get() → reads sessionStorage → session present → showDashboard()

New tab / browser restart:
[DOMContentLoaded] → sbSession.get() → sessionStorage empty → showLogin()
```

### Authenticated Edge Function Call (post-change)

```
[UI handler] → callEdge('submit-enquiry', { listing_id, message }, { auth: true })
         ↓
[callEdge] → sbAuth('GET_SESSION')
              ↓ (auto-refresh if within 60s of expiry)
              ↓
              → headers.Authorization = 'Bearer ' + s.access_token
         ↓
[fetch POST /functions/v1/submit-enquiry]
         ↓
[Edge Function server] → verify JWT → derive renter_id = auth.uid()
         ↓
[Response] → { ok: true, enquiry_id }
         ↓
[UI] → show success state
```

### CSP Hash Flow at Deploy Time

```
[Pre-deploy step]
  openssl dgst -sha256 -binary <(extract-script-block index.html 1) | base64
  → 'sha256-AAA...'
  openssl dgst -sha256 -binary <(extract-script-block index.html 2) | base64
  → 'sha256-BBB...'
  ↓
[Update vercel.json]
  script-src 'self' 'sha256-AAA...' 'sha256-BBB...'
  ↓
[git commit + push]
  ↓
[Vercel build] → static deploy → response headers carry the new CSP
  ↓
[Browser] → loads page → SHA-256 of each inline block matches → executes
```

If hashes drift (whitespace edit without re-hashing): browser blocks the script, page is dead, Vercel rollback covers it.

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `index.html` | Modify | Add `sbSession` wrapper (~L2180 region). Replace L2180/2191/2204/2215/2219/2226 reads/writes with wrapper. Remove `fmn_reset_token` `localStorage` calls at L2340, L3795. Replace 4 Edge Function fetches with `callEdge` (L2382, L3123, L4587, L4682). Convert risky DOM sinks per ADR-1. Migrate 100 inline handlers per ADR-5. Add the `callEdge` helper near `sbq`/`sbAuth`. |
| `vercel.json` | Modify | Replace `'unsafe-inline'` in `script-src` with two `'sha256-...'` tokens. Other directives unchanged. |
| `openspec/changes/security-hardening-phase-0/verify-report.md` | Create (by sdd-verify) | Evidence per scenario. |
| `.github/workflows/main.yml` | Out of scope | FTP-deploy concern is a separate Phase 0 item. |

No new files (we explicitly reject moving to external `app.js`; deferred).

---

## Interfaces / Contracts

### `sbSession` wrapper (auth-token-storage)

```js
var sbSession = {
  get: function() {
    try {
      var v = sessionStorage.getItem('sb_session');
      if (v) return JSON.parse(v);
      // One-release migration fallback (remove in cleanup commit):
      var legacy = localStorage.getItem('sb_session');
      if (legacy) {
        sessionStorage.setItem('sb_session', legacy);
        localStorage.removeItem('sb_session');
        return JSON.parse(legacy);
      }
      return null;
    } catch(e) { return null; }
  },
  set: function(blob) {
    sessionStorage.setItem('sb_session', JSON.stringify(blob));
  },
  clear: function() {
    sessionStorage.removeItem('sb_session');
    localStorage.removeItem('sb_session'); // belt-and-suspenders during migration
  }
};

// Recovery token: in-memory only.
var __recoveryToken = null;
function setRecoveryToken(t) { __recoveryToken = t; }
function getRecoveryToken() { return __recoveryToken; }
function clearRecoveryToken() { __recoveryToken = null; }
```

### `callEdge` helper (edge-fn-client-auth)

See ADR-4 for full code. Signature: `callEdge(name: string, body: object, opts?: { auth?: boolean }) → Promise<any>`.

### Data-action dispatcher (csp-strict / ADR-5)

```js
var ACTIONS = {
  openAuth: function(el){ openAuth(); },
  openEditListing: function(el){ openEditListing(el.dataset.id); },
  doRemove: function(el){ doRemove(el.dataset.id); },
  viewListing: function(el){ viewListing(el.dataset.id); },
  closeAuth: function(el){ closeAuth(); },
  // ... full action map populated during Battle 3a commits
};
```

---

## Rollout Sequence (Commit Order)

| # | Battle | Commit | Depends on |
|---|--------|--------|------------|
| 1 | **Battle 1 — XSS** | Add sanitization helpers; convert risky paths (`rent-estimate` insight, `flatmate-match` result, `<img src=>` attribute paths) to DOM API; enforce `esc()` on remaining `innerHTML`. | — |
| 2 | **Battle 2 — Token storage** | Add `sbSession` wrapper with read-fallback. Replace all auth-token `localStorage` calls. Move recovery token in-memory. | Battle 1 (so dashboard renders work in dev) |
| 3a-1 | **Battle 3a #1** | Migrate auth inline handlers → data-action dispatcher. | Battle 2 (auth flow stable) |
| 3a-2 | **Battle 3a #2** | Migrate landlord listings CRUD handlers. | 3a-1 |
| 3a-3 | **Battle 3a #3** | Migrate renter dashboard nav + listing card handlers. | 3a-2 |
| 3a-4 | **Battle 3a #4** | Migrate enquiry flow handlers. | 3a-3 |
| 3a-5 | **Battle 3a #5** | Migrate AI panels + modal handlers. | 3a-4 |
| 3b | **Battle 3b — CSP** | Compute SHA-256 of inline blocks; update `vercel.json` `script-src`. Remove `'unsafe-inline'`. | All of 3a (else dispatcher itself breaks) |
| 4 | **Battle 4 — Edge auth** | Add `callEdge` helper. Convert 4 fetch sites. Remove client-asserted identity fields. | Battle 2 (live session getter required) |
| 5 | **Cleanup** | Remove `localStorage` read-fallback from `sbSession.get()`. Drop the migration copy logic. | One full release window after Battle 2 lands |

Battles 1, 2, 3a, 3b can ship in one PR. Battle 4 ships either in the same PR (if server-side coordination is ready) or in a follow-up PR. Cleanup commit ships ≥1 release later.

---

## Cross-System Coordination

**Battle 4 has a hard server-side dependency.** Server-side Edge Function changes are required for end-to-end correctness:
- `send-email` server: validate JWT, derive recipient from `listing_id` + `auth.uid()`, reject calls missing `Authorization`.
- `submit-enquiry` server: validate JWT, derive `renter_id` from `auth.uid()` (ignore body field), reject calls missing `Authorization`.
- `flatmate-match` server: validate JWT, derive renter from JWT + `flatmate_profiles`, ignore client-sent `renter`.
- `rent-estimate` server: add rate-limit + abuse mitigation (per orchestrator decision).

**Ship order requirement.** Server-side enforcement MUST land **before or with** Battle 4 client-side ship. If client lands first, the function still works (server accepts old contract) — no regression. If server lands first, client without `Authorization` returns `401` and breaks (regression). Therefore: ship server first, then client.

**If server cannot be coordinated.** Defer Battle 4 to a follow-up change. Battles 1–3 are independent and ship without waiting. This is flagged in Risks.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **`ai-listing` Edge Function is unclassified.** Orchestrator's classification table covers `send-email`, `submit-enquiry`, `flatmate-match`, `rent-estimate` — but `index.html:4454, 4506` also calls `ai-listing` (two places). Spec `edge-fn-client-auth` does not list it. **Need orchestrator/user decision before Battle 4.** | High | Surface in summary. Default: treat as public like `rent-estimate` (no auth) and add to a follow-up change. Until then, leave its `fetch` untouched. |
| **CSP hash drift after a whitespace-only edit** breaks production. | Med | Pre-deploy hash check in verification checklist. Vercel instant rollback as net. Future: move to external `app.js`. |
| **Dispatcher misses a converted handler** → silently dead button. | Med | `rg "on(click\|submit\|change\|load\|input\|keydown\|keyup\|mouseover\|mouseout\|focus\|blur)=" index.html` MUST return 0. Smoke checklist exercises every interactive surface. |
| **Battle 4 client lands without server coordination** → `submit-enquiry` / `send-email` 401 in prod. | Med | Strict ship-order rule above. Defer Battle 4 if server isn't ready. |
| **Logout on existing users at Battle 2 deploy** (read-fallback fails). | Low | Read-fallback explicitly tested: with a `localStorage['sb_session']` pre-seeded, post-deploy first load MUST migrate to `sessionStorage` without re-login prompt. |
| **`flatmate_profiles` server-side derivation may not exist yet.** Spec says server derives renter from JWT + `flatmate_profiles`. If the row doesn't exist on the renter's first `flatmate-match` call, server returns 400; client UX needs a "complete your profile" path. | Med | Flag for server change; client-side fallback message ("Complete your renter profile to use flatmate-match") added in Battle 4. |
| **Hard-reload UX regression.** `sessionStorage` does survive hard reload in the same tab — but if Vercel's preview-deploy URL changes or user opens DevTools "Disable cache", behavior could surprise. | Low | Documented in `auth-token-storage` scenario "Hard reload behavior is explicitly defined." |
| **Recovery flow tightly couples to a single page session.** If a user opens the reset link, switches tabs to copy a password, and returns to the original tab, the in-memory `__recoveryToken` survives (good). If they reload the recovery tab, it's gone — they need a fresh link. | Low | Acceptable UX; document in commit message. |

---

## Open Questions

- [ ] **`ai-listing` Edge Function classification** — public or private? (Two call sites at L4454, L4506 are NOT in spec.) Need decision before Battle 4 ships.
- [ ] **`send-email` recipient derivation contract** — does server derive `to` from `listing_id` alone, or does the client still pass `type` for template selection? Final contract is server-side decision; design assumes server derives recipient, client keeps `type` + `confirmationUrl`.
- [ ] **Exact SHA-256 extraction command** for inline `<script>` blocks given Vercel's line-ending behavior — to be specified in tasks.md with a tested one-liner.

---

## Migration / Rollout

See **Rollout Sequence** above. No database migration required (token migration is client-side, one release cycle). Feature flags not used (single-file SPA constraint). Rollback per commit as described in proposal.

---

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | n/a | No test runner; project standard. |
| Integration | n/a | No test runner. |
| Manual | Every scenario from each spec | DevTools (Network/Console/Application) + `rg` audits + `curl -I` for headers. Evidence captured in `verify-report.md` per the manual checklist. |
| Smoke | Login / signup / logout / refresh / dashboard load / listing CRUD / enquiry / AI panels | Run post-each-Battle and in the final pre-deploy pass. |

Strict TDD is **disabled** for this project; no test code is proposed.

---

## Scope Adjustment (post-design)

After this design was drafted, two scope decisions were taken:

### 1. `ai-listing` Edge Function classified as private

`ai-listing` (called at `index.html:4454` from `generateDescription` and `index.html:4506` from `generateRoomDescription`) is **private**: requires `Authorization: Bearer` + server-side rate-limit. No PII in body, but LLM-backed (cost abuse risk). Only invoked from logged-in landlord/room-poster forms — no UX regression.

Updated Edge Function classification:

| Function | Status | Action |
|----------|--------|--------|
| `send-email` | private | Bearer + server-derived recipient |
| `submit-enquiry` | private | Bearer + server-derived `renter_id` |
| `flatmate-match` | private | Bearer + server-derived renter from JWT |
| `ai-listing` | **private (new)** | Bearer + server-side rate-limit |
| `rent-estimate` | public | No auth; server-side rate-limit |

### 2. Battle 4 deferred to follow-up change

User does not currently have access to Supabase Edge Function server code. Shipping client-side `Authorization: Bearer` without coordinated server-side JWT validation is **worst-of-both-worlds**: breaks the flow if the server later starts enforcing, and adds no real security if the server never enforces.

**This change (`security-hardening-phase-0`) now ships only Battles 1, 2, 3:**

- Battle 1: `client-xss-defense`
- Battle 2: `auth-token-storage`
- Battle 3: `csp-strict`

**Deferred to follow-up change (working name `security-hardening-phase-1-edge-auth`):**

- Battle 4: `edge-fn-client-auth` — to ship when server-side Edge Function code can be coordinated.

The spec at `specs/edge-fn-client-auth/spec.md` stays in this change directory for traceability and to seed the follow-up change. Verify phase MUST NOT validate its scenarios in this change. Rollout sequence in this design supersedes: Battles 1-3 ship; Battle 4 commits are skipped.

**Cross-system coordination** (previously a Battle 4 risk) is moved out of this change's risk surface.
