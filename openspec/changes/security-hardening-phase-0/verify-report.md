# Verify Report — security-hardening-phase-0

**Status**: PASS (static checks) — manual smoke tests PENDING before PR merge

**Date**: 2026-06-02  
**Branch**: security/hardening-phase-0  
**Scope**: Battles 1, 2, 3a, 3b — Battle 4 (edge-fn-client-auth) INTENTIONALLY DEFERRED

---

## Overall Verdict

| Battle | Static Verdict | Manual Smoke |
|--------|---------------|--------------|
| Battle 1 — client-xss-defense | PASS | PENDING (5 scenarios) |
| Battle 2 — auth-token-storage | PASS | PENDING (6 scenarios) |
| Battle 3a — inline handler migration | PASS | PENDING (D.6.2 full walk) |
| Battle 3b — csp-strict | PASS | PENDING (E.3.1 / E.3.2 deploy check) |
| Battle 4 — edge-fn-client-auth | DEFERRED — out of scope | N/A |

**No CRITICAL issues found.** One WARNING (duplicate function definitions). Static implementation satisfies all spec requirements for Battles 1–3.

---

## Static Evidence Table

All checks performed on `index.html` (5241 lines) and `vercel.json` at commit HEAD of branch `security/hardening-phase-0`.

### CHECK-1 — No inline HTML event-handler attributes

```
$ grep -noE '<[^>]*\son(error|load|click|submit|change|input|focus|blur|keydown|keyup|mouseover|mouseout)=' index.html
(no output — 0 hits)
```

Result: **PASS**

The sole `on*` match found by the broader grep is:
```
3399:    document.getElementById('hcbtn').onclick=function(){viewListing(l.id);};
```
This is a JavaScript property assignment inside a `<script>` block, **not** an HTML attribute — confirmed by context. The strict HTML-attribute pattern (`<[^>]* on...=`) returns zero.

---

### CHECK-2 — No localStorage.setItem for sensitive tokens

```
$ grep -nE "localStorage\.setItem\([^)]*(access_token|refresh_token|sb_session|fmn_reset_token)" index.html
(no output — 0 hits)
```

Result: **PASS**

Remaining localStorage operations:
- `fmn_u` (non-sensitive profile blob) — permitted per ADR-2 and spec.
- Migration fallback `localStorage.getItem('sb_session')` in `sbSession.get()` — read-only, no setItem.
- `localStorage.removeItem('sb_session')` in `sbSession.clear()` — belt-and-suspenders removal, no write.

---

### CHECK-3 — No data-* attribute interpolations without esc()

```
$ grep -nE 'data-[a-z]+="\$\{' index.html | grep -v 'esc('
(no output — 0 hits)

$ grep -n "data-id=" index.html | grep '\$' | grep -v 'esc('
(no output — 0 hits)
```

Result: **PASS**

Sample evidence of correct escaping:
```
2966: data-id="'+esc(l.id)+'"   (doRemove / openEditListing)
3113: data-id="'+esc(l.id)+'"   (viewListing)
```

---

### CHECK-4 — ACTIONS map has no window[name] / eval / new Function

```
$ grep -n "window\[" index.html
1984:// RULE: ACTIONS must be an explicit object map — NO window[name] or string-to-

$ grep -n "new Function\|eval(" index.html
(no output — 0 hits)
```

Result: **PASS**

The only `window[` match is a comment in the security rule itself. The ACTIONS map (lines ~1990–2070) is a plain object literal with explicit function entries; no dynamic dispatch.

---

### CHECK-5 — CSP script-src has no 'unsafe-inline' or 'unsafe-eval'

From `vercel.json` (line 8):
```
script-src 'self' 'sha256-OfmZGwTVwPfJT+793oXzzTqk+3SRehlrmfDh8/gb/p0=' 'sha256-AujzrY8eWcJP7/G3g+YJARz8jfBRXRt0inaUh0BYny0='
```

```
$ grep -n "unsafe-inline\|unsafe-eval" vercel.json | grep "script-src"
(no match in script-src — 'unsafe-inline' appears only in style-src, which is out of scope)
```

Result: **PASS** — `script-src` has `'self'` + exactly 2 `sha256-` hashes, no `'unsafe-inline'`, no `'unsafe-eval'`.

---

### CHECK-6 — SHA-256 hashes independently recomputed and verified

Script block ranges (auto-detected):
- Block 1: `<script>` at line 1916, `</script>` at line 5130. Body: lines 1917–5129.
- Block 2: `<script>` at line 5157, `</script>` at line 5238. Body: lines 5158–5237.

Hash computation (CSP spec: hash of content between opening `<script>` and closing `</script>`, with leading `\n`):

```
$ printf '\n' > /tmp/block1.txt && sed -n '1917,5129p' index.html >> /tmp/block1.txt
$ openssl dgst -sha256 -binary /tmp/block1.txt | openssl base64 -A
OfmZGwTVwPfJT+793oXzzTqk+3SRehlrmfDh8/gb/p0=

$ printf '\n' > /tmp/block2.txt && sed -n '5158,5237p' index.html >> /tmp/block2.txt
$ openssl dgst -sha256 -binary /tmp/block2.txt | openssl base64 -A
AujzrY8eWcJP7/G3g+YJARz8jfBRXRt0inaUh0BYny0=
```

vercel.json values:
- Block 1: `sha256-OfmZGwTVwPfJT+793oXzzTqk+3SRehlrmfDh8/gb/p0=` — **MATCH**
- Block 2: `sha256-AujzrY8eWcJP7/G3g+YJARz8jfBRXRt0inaUh0BYny0=` — **MATCH**

Result: **PASS** — both hashes independently verified.

Note: tasks.md recorded a different Block 1 hash (`sha256-BOuMl/...`) during initial implementation. The value in `vercel.json` is `sha256-OfmZGwTVwPfJT+...`, which is what the independent recompute also produces. The vercel.json value is authoritative.

---

### CHECK-7 — sbSession wrapper, recovery token, sessionStorage usage

```
$ grep -nE "sessionStorage\.(setItem|getItem|removeItem).*sb_session" index.html
1954:  var s = sessionStorage.getItem('sb_session');
1959:  sessionStorage.setItem('sb_session', legacy);
1967:  try { sessionStorage.setItem('sb_session', JSON.stringify(blob)); } catch(e) {}
1971:  sessionStorage.removeItem('sb_session');

$ grep -n "fmn_reset_token\|setRecoveryToken\|getRecoveryToken\|clearRecoveryToken" index.html
1977: var __recoveryToken = null;
1978: function setRecoveryToken(t) { __recoveryToken = t; }
1979: function getRecoveryToken() { return __recoveryToken; }
1980: function clearRecoveryToken() { __recoveryToken = null; }
3979: setRecoveryToken(params.access_token);   (formerly localStorage.setItem('fmn_reset_token'))
2409: clearRecoveryToken();
2523: var token = getRecoveryToken();
```

Result: **PASS** — `sbSession` wrapper is present per ADR-2 contract. Recovery token is in-memory only. No `localStorage.setItem('fmn_reset_token', ...)` remains.

---

### CHECK-8 — DOM API for LLM output (rent-estimate + flatmate-match)

Rent-estimate insight (`index.html:4793–4805`):
```js
// data.insight is LLM output (untrusted) — render via DOM API, never innerHTML
insightEl.textContent = '';
insightTitle.textContent = '🤖 AI Market Insight:';
document.createTextNode(data.insight)   // LLM body via createTextNode
```
Result: **PASS** — no `innerHTML` with `data.insight`.

Flatmate-match positives/concerns (`index.html:4904–4930`):
```js
// data.positives is LLM output (untrusted), render via DOM API
item.textContent = '✓ ' + p;
item.textContent = '✕ ' + c;
```
Result: **PASS** — no `innerHTML` with LLM response fields.

---

### CHECK-9 — capture-phase error listener (replaces onerror= attributes)

```
$ grep -n "addEventListener.*error" index.html
2096:  document.addEventListener('error', function(e) {
```

Line 2096 is called with `true` (capture phase) as third argument — required because `error` events on `<img>` do not bubble. This is the CSP-safe replacement for any former `onerror=` attributes.

Result: **PASS**

---

### CHECK-10 — esc() helper and code-standards comment

```
$ grep -n "RULE: no innerHTML" index.html
1923: // RULE: no innerHTML with ${...} unless every interpolated value is esc()'d.

$ grep -n "RULE: ACTIONS must be an explicit" index.html
1984: // RULE: ACTIONS must be an explicit object map — NO window[name] or string-to-
```

Result: **PASS** — project standards comments present.

---

## Issues

### WARNING-1 — Duplicate function definitions (clearUser at L2163 vs L2417)

`clearUser()` is defined twice:
- L2163: `function clearUser(){localStorage.removeItem('fmn_u');}` — does NOT call `sbSession.clear()`
- L2417: `function clearUser() { localStorage.removeItem('fmn_u'); sbSession.clear(); clearRecoveryToken(); }` — correct

In JS, the last function declaration hoisted wins, so L2417 is the effective function at runtime. However, the duplicate at L2163 is a latent maintenance hazard: if the wrong block is edited, the auth-clearing logic may be silently lost.

**Recommendation**: Remove the duplicate definitions at L2161–2163 in a follow-up cleanup commit (same window as the sbSession fallback removal per task F.3).

### SUGGESTION-1 — tasks.md Block 1 hash mismatch note

tasks.md (E.1.2) documents Block 1 hash as `sha256-BOuMl/Zihzpvt3I904outzZq8XC97xmBHm4x9p1FLNE=`. The actual hash in `vercel.json` and independently recomputed is `sha256-OfmZGwTVwPfJT+793oXzzTqk+3SRehlrmfDh8/gb/p0=`. This discrepancy in the audit trail (tasks.md records an intermediate value before a final recompute) is not a functional issue but should be noted for future reference.

---

## Task Completeness (Battles 1–3)

| Phase | Static/Implementation Tasks | Smoke Tasks | Status |
|-------|---------------------------|-------------|--------|
| Phase A (audit) | A.1–A.3 all checked | — | COMPLETE |
| Phase B (Battle 1) | B.1–B.4.1, B.4.3 checked | B.4.2 unchecked | PENDING SMOKE |
| Phase C (Battle 2) | C.1–C.4.1, C.4.3 checked | C.4.2 unchecked | PENDING SMOKE |
| Phase D (Battle 3a) | D.0–D.6.1, D.1.4, D.2.5, D.3.4, D.4.4, D.5.4, D.5.x.1–5 checked | D.1.3, D.2.4, D.3.3, D.4.3, D.5.3, D.5.x.6, D.6.2 unchecked | PENDING SMOKE |
| Phase E (Battle 3b) | E.1–E.2.2, E.3.3, E.3.4 checked | E.3.1, E.3.2 unchecked | PENDING DEPLOY |
| Phase F (cleanup) | — | F.1 (this doc), F.2 (PR), F.3 (later) | IN PROGRESS |
| Deferred | Battle 4 all tasks | — | DEFERRED |

---

## Consolidated Manual Smoke Checklist (owed before PR merge)

The following manual tests MUST be executed by the developer in a real browser. Each requires a screenshot attached to this document or the PR body as evidence.

---

### BATTLE 1 — client-xss-defense (5 scenarios)

**Scenario B1-1 — Listing title XSS payload**
1. Log in as a landlord.
2. Create (or edit) a listing with title: `<img src=x onerror="alert('xss1')">`
3. Navigate to "My Listings" in the landlord dashboard.
4. VERIFY: the title renders as literal angle-bracket text, no alert fires.
5. Evidence: screenshot of the listing card showing escaped title + DevTools Console showing no alert.

**Scenario B1-2 — Enquiry message XSS payload**
1. Log in as a renter, submit an enquiry on any listing with message body: `<script>alert('xss2')</script>`
2. Log in as the landlord on that listing, open the enquiry inbox.
3. VERIFY: message renders as literal `<script>` text visible on screen, no alert fires.
4. Evidence: screenshot of the enquiry detail showing escaped text + Console clean.

**Scenario B1-3 — AI Rent Estimate LLM injection (simulated)**
1. Log in, navigate to any listing and open the AI Rent Estimate panel.
2. Trigger "Get AI Rent Estimate" to confirm the panel loads normally.
3. In DevTools Console, run:
   ```js
   var el = document.querySelector('[id$="insight"]');
   el.textContent = '';
   var t = document.createElement('strong');
   t.textContent = 'TEST';
   el.appendChild(t);
   el.appendChild(document.createTextNode('<iframe src=javascript:alert(1)></iframe>'));
   ```
4. VERIFY: `el.querySelector('iframe')` returns `null`. The text appears as literal characters.
5. Evidence: DevTools Elements screenshot — no `<iframe>` child in the insight div.

**Scenario B1-4 — Flatmate-match LLM injection (simulated)**
1. Log in as a renter with a flatmate profile, open the flatmate-match panel.
2. Trigger "Check My Compatibility" to open the result modal.
3. In DevTools Console, run:
   ```js
   var p = document.getElementById('compatPositives');
   p.textContent = '';
   var div = document.createElement('div');
   div.className = 'match-positive';
   div.textContent = '✓ <img src=x onerror="alert(1)">';
   p.appendChild(div);
   ```
4. VERIFY: `<img>` renders as literal text. No alert fires. No `<img>` element in `compatPositives`.
5. Evidence: DevTools screenshot of DOM + Console clean.

**Scenario B1-5 — Photo URL attribute injection**
1. Using Supabase Dashboard or DevTools, set a listing's `photo_urls` array to include: `https://evil.com/x.jpg" onerror="alert('attr-xss')"`
2. Reload the listing card.
3. VERIFY: DevTools "Inspect element" shows `src` value has `&quot;` entity; no `onerror` attribute on the `<img>` element; no alert fires.
4. Evidence: DevTools Elements screenshot showing the escaped attribute.

---

### BATTLE 2 — auth-token-storage (6 scenarios)

**Scenario B2-1 — Fresh login stores token in sessionStorage only**
1. Open DevTools → Application → Storage → Clear site data.
2. Log in with valid credentials.
3. VERIFY: `sessionStorage` shows `sb_session` key with access/refresh tokens. `localStorage` shows NO `sb_session`, `access_token`, `refresh_token`, or `recovery` keys.
4. In Console, run: `Object.keys(localStorage).filter(k => /access_token|refresh_token|sb_session|recovery|fmn_reset_token/i.test(k))`
5. VERIFY: returns `[]`.
6. Evidence: screenshot of both storage panes + Console output.

**Scenario B2-2 — Token refresh rotates session without touching localStorage**
1. While logged in, trigger a token refresh by running in Console:
   ```js
   await fetch(SB_URL+'/auth/v1/token?grant_type=refresh_token', {
     method:'POST',
     headers:{apikey:SB_KEY,'Content-Type':'application/json'},
     body:JSON.stringify({refresh_token: JSON.parse(sessionStorage.getItem('sb_session')).refresh_token})
   });
   ```
2. VERIFY: `sessionStorage.sb_session` updates to a new blob. `localStorage` remains unchanged (still empty of auth keys).
3. Evidence: before/after screenshot of `sessionStorage` value showing updated token.

**Scenario B2-3 — Logout clears both stores**
1. While logged in, click the logout button.
2. VERIFY: both `sessionStorage.sb_session` and any `localStorage.sb_session` are removed. Subsequent authed UI action prompts login (or returns to logged-out state).
3. Evidence: screenshot of Application tab showing both stores cleared of auth keys post-logout.

**Scenario B2-4 — Same-tab reload preserves session; new tab does not**
1. While logged in, do a same-tab reload (Cmd/Ctrl+R).
2. VERIFY: still logged in after reload.
3. Open the app in a new browser tab.
4. VERIFY: new tab starts logged-out (no session).
5. Close all tabs, reopen browser, navigate to the app.
6. VERIFY: browser restart → logged out.
7. Evidence: screenshots of each step.

**Scenario B2-5 — Legacy localStorage migration**
1. While logged out, in Console pre-seed: `localStorage.setItem('sb_session', JSON.stringify({access_token:'fake_legacy',refresh_token:'fr','expires_at':Date.now()/1000+3600}))`
2. Reload the page (without re-login).
3. VERIFY: `sbSession.get()` reads from localStorage, copies to sessionStorage, removes legacy key. After reload: `localStorage.sb_session` is gone, `sessionStorage.sb_session` has the value. (Note: the fake token will fail auth calls — that is expected. The migration mechanism itself is what is being tested.)
4. Evidence: before/after screenshot of both storage panes.

**Scenario B2-6 — XSS cannot read auth tokens via localStorage**
1. While logged in, in DevTools Console run:
   ```js
   localStorage.getItem('sb_session')
   localStorage.getItem('access_token')
   Object.keys(localStorage).filter(k => /access_token|refresh_token|sb_session|recovery/i.test(k))
   ```
2. VERIFY: all return `null` / `[]`.
3. Evidence: screenshot of Console output showing `null`, `null`, `[]`.

---

### BATTLE 3a — Full smoke walk (D.6.2)

Walk every previously-interactive surface and confirm the `data-action` dispatcher handles all events correctly with zero CSP violations in DevTools Console.

**Steps:**
1. Open a fresh browser profile (or incognito). Open DevTools Console.
2. Navigate to `/` (home page).
3. Click "Sign Up / Log In" — auth modal opens.
4. Sign up with a new test account — form submits, account created, or confirmation shown.
5. Log in with credentials — login succeeds, dashboard shown.
6. Renter dashboard: click each navigation tab (Search, Short-Term, Flatmates, My Profile, Saved) — each switches panel.
7. Click a listing card — listing detail opens.
8. Submit an enquiry on the listing — enquiry submission succeeds.
9. Click logout — returns to home.
10. Log in as a landlord account.
11. Landlord dashboard: click "Add Listing" — form opens.
12. Fill and submit the add-listing form — listing created.
13. Click "Edit" on an existing listing — edit modal opens; make a change; save.
14. Click "Delete" on a listing — listing removed (or confirmation prompt).
15. Open AI panels: "Rent Estimate" panel — enter values, click button, result appears.
16. Flatmate-match panel (if accessible) — similar.
17. Click logout.

**VERIFY throughout**: DevTools Console shows zero messages containing `Content Security Policy`, `Refused to execute inline script`, or `Refused to apply inline style`.

**Evidence**: sequential screenshots or screen recording covering each step; Console screenshot at end showing clean output.

---

### BATTLE 3b — CSP deploy verification (E.3.1 / E.3.2)

**Scenario E.3.1 — No CSP violations in production/preview**

This scenario repeats the D.6.2 smoke walk above but against the deployed Vercel preview URL (not localhost). The critical difference is that the SHA-256 hashes in `vercel.json` must match the deployed `index.html` for the page to function at all.

1. Deploy the branch to a Vercel preview.
2. Open the preview URL in a fresh browser profile with DevTools Console open.
3. Execute the full smoke walk (steps 2–17 from D.6.2 above).
4. VERIFY: Console shows zero CSP violation messages.
5. Evidence: Console screenshot post-walkthrough.

**Scenario E.3.2 — curl CSP header check**

```bash
curl -sI https://<your-preview-url>/ | grep -i "content-security-policy"
```

Expected output must contain:
- `script-src 'self' 'sha256-OfmZGwTVwPfJT+793oXzzTqk+3SRehlrmfDh8/gb/p0=' 'sha256-AujzrY8eWcJP7/G3g+YJARz8jfBRXRt0inaUh0BYny0='`
- NO `'unsafe-inline'` within `script-src`
- NO `'unsafe-eval'` within `script-src`

Evidence: terminal screenshot or copy of the full `Content-Security-Policy` header value.

---

## Pass criteria before PR merge

- [ ] All 5 Battle 1 scenarios documented as passing (screenshots attached to PR).
- [ ] All 6 Battle 2 scenarios documented as passing (screenshots attached to PR).
- [ ] D.6.2 full smoke walk completed; Console clean throughout (screenshots attached to PR).
- [ ] E.3.1 preview deploy smoke walk completed; Console clean (screenshots attached to PR).
- [ ] E.3.2 `curl -sI` output confirms `script-src` has exactly the two SHA-256 hashes and no unsafe tokens (terminal output attached to PR).
- [ ] No JavaScript errors in Console during any of the above tests.

---

## Out of Scope — Battle 4 (edge-fn-client-auth)

Battle 4 is intentionally deferred to follow-up change `security-hardening-phase-1-edge-auth`. It is NOT a failure of this change. Rationale: server-side Edge Function code is not currently accessible; shipping client-side `Authorization: Bearer` without coordinated server-side enforcement would break existing flows without providing security benefit.

The spec at `specs/edge-fn-client-auth/spec.md` remains in this change directory for traceability and to seed the follow-up change.
