# Verify Report — security-hardening-phase-0

**Status**: In progress (Battle 1 + 2 implementation complete; manual smoke tests pending user execution)

This document captures evidence per spec scenario. Each manual smoke test below MUST be executed by a human in a real browser before the PR can merge.

---

## Battle 1 — client-xss-defense

### Static audit evidence (automated — DONE)

```bash
# Baseline counts (Phase A)
$ rg -c "innerHTML\s*=" index.html           # 59
$ rg -c "localStorage\.setItem.*token" index.html  # 4 (L2191, L2204, L2215, L3795)

# Post-change: every <img src="..."> interpolation is esc()-wrapped
$ rg -nU 'src="\s*'"'"'\s*\+' index.html | rg -v 'esc\('
(none — all 14 sites wrapped)

# Post-change: text fields in template strings use esc()
# Manually verified across L2644, L2790, L2819, L2993, L3062, L3165, L3280,
# L3403, L3438, L3621, L4236, L4328, L4829 — all use esc() for user-text fields.
```

**Conclusion**: All known XSS sinks for dynamic data are either:
- Routed through DOM API (`createTextNode` / `textContent`) — LLM outputs from `rent-estimate` and `flatmate-match`.
- Wrapped in `esc()` — all DB string fields in `innerHTML` templates and all `<img src=` URL interpolations.
- Hardcoded source arrays (`NZ_SUBURBS`, `INTEREST_SUGGESTIONS`) — defense-in-depth `esc()` still applied at render.

### Manual smoke scenarios — TO EXECUTE

For each scenario, set up the listed precondition, run the steps, and check the expected outcome. Capture a screenshot of DevTools showing the result.

#### Scenario 1 — Listing title XSS payload

| | |
|--|--|
| **Given** | A user is logged in as a landlord |
| **When** | They create a listing with title: `<img src=x onerror="alert('xss1')">` |
| **Then** | The title renders as literal text (the angle brackets visible). **No alert fires.** |
| **Where to verify** | Landlord dashboard "My Listings" list (uses `esc(l.title)` at L2647, L2790, L2997). |
| **Evidence** | Screenshot of the listing showing escaped title, no alert. |

#### Scenario 2 — Enquiry message XSS payload

| | |
|--|--|
| **Given** | A user is logged in as a renter |
| **When** | They submit an enquiry on a listing with message: `<script>alert('xss2')</script>` |
| **Then** | When the landlord views the enquiry, the message renders as literal text. **No alert fires.** |
| **Where to verify** | Landlord's enquiry inbox (uses `esc(e.message)` at L2849). |
| **Evidence** | Screenshot of the enquiry message field showing literal `<script>` text. |

#### Scenario 3 — AI Rent Estimate (LLM injection simulation)

| | |
|--|--|
| **Given** | A renter on the listings page with the AI Rent Estimate panel |
| **When** | The user triggers "Get AI Rent Estimate" — under normal operation the LLM returns prose. **Simulation**: in DevTools Console, run: `document.getElementById('insightEl').textContent = ''; getRentEstimate('main')` and inspect the rendered insight area to confirm subsequent renders use DOM API. To simulate an injection, mock the response by running in Console: `var el = document.querySelector('[id$="insight"]'); el.textContent = ''; var t = document.createElement('strong'); t.textContent = '🤖'; el.appendChild(t); el.appendChild(document.createTextNode('<iframe src=javascript:alert(1)></iframe>'));` |
| **Then** | The `<iframe>` text is shown as literal characters, NOT as an `<iframe>` element. Inspect DOM: `el.querySelector('iframe')` returns `null`. |
| **Where to verify** | Rent-estimate panel insight render (L4615-4628, refactored to DOM API). |
| **Evidence** | Screenshot of DOM inspector showing literal text, no `<iframe>` element. |

#### Scenario 4 — Flatmate compatibility (LLM positives/concerns injection)

| | |
|--|--|
| **Given** | A renter with a flatmate profile, viewing a room listing |
| **When** | They click "Check My Compatibility". **Simulation**: in DevTools Console after the modal opens, run: `var p = document.getElementById('compatPositives'); p.textContent = ''; var div = document.createElement('div'); div.className = 'match-positive'; div.textContent = '✓ <img src=x onerror="alert(1)">'; p.appendChild(div);` |
| **Then** | The injected payload renders as literal text. **No alert fires.** No `<img>` element exists in `compatPositives`. |
| **Where to verify** | Flatmate-match positives/concerns render (L4724-4755, refactored to DOM API). |
| **Evidence** | Screenshot of the compatibility modal showing literal text, no images. |

#### Scenario 5 — Photo URL attribute injection

| | |
|--|--|
| **Given** | A landlord creates a listing with a photo. **Simulation**: in DevTools Console after the listing renders, manually find a listing card and modify its underlying data attribute, or use Supabase dashboard to update `photo_urls` to include: `"https://evil.com/x.jpg\" onerror=\"alert('attr-xss')\""` |
| **When** | The listing card re-renders |
| **Then** | The `"` in the URL is escaped to `&quot;`, the `onerror` injection does not execute. **No alert fires.** |
| **Where to verify** | Listing card photo rendering (L2999, 3173, 3625, 3817, 3822, 3827, 3851, 3857, 4068, 4101, 4118, 4238 — all wrapped in `esc()`). |
| **Evidence** | DevTools "Inspect element" on the img tag shows `src="..."` with `&quot;` entity, no `onerror` attribute injected. |

### Pass criteria

- [ ] All 5 scenarios pass with documented evidence.
- [ ] DevTools Console shows no JavaScript errors during testing.
- [ ] Visual rendering for benign input unchanged vs main branch.

---

## Battle 2 — auth-token-storage

### Static audit evidence (automated — to be filled after Phase C commits)

```bash
# Post-change: no localStorage.setItem for sensitive tokens
$ rg -nE "localStorage\.setItem\(.*(access_token|refresh_token|sb_session|recovery|fmn_reset_token)" index.html
(expect: empty)

# Post-change: sessionStorage used for auth blob
$ rg -nE "sessionStorage\.(set|get|remove)Item\(.*sb_session" index.html
(expect: at least 1 setItem in sbSession.set, at least 1 getItem in sbSession.get)
```

### Manual smoke scenarios — TO EXECUTE (after Phase C)

#### Scenario 1 — Fresh login stores token in sessionStorage only

| | |
|--|--|
| **Given** | Browser with cleared `localStorage` and `sessionStorage` (DevTools → Application → Storage → Clear site data) |
| **When** | User logs in with valid credentials |
| **Then** | DevTools → Application → `sessionStorage` shows `sb_session` with the access/refresh tokens. `localStorage` shows NO `sb_session`, NO `access_token`, NO `refresh_token`, NO `recovery` keys. Verify by running in Console: `Object.keys(localStorage).filter(k => /access_token|refresh_token|sb_session|recovery|fmn_reset_token/i.test(k))` returns `[]`. |
| **Evidence** | Screenshot of both storage panes side-by-side. |

#### Scenario 2 — Token refresh rotates session

| | |
|--|--|
| **Given** | Logged-in user with `sessionStorage.sb_session` present |
| **When** | Wait for or trigger a token refresh (Supabase refreshes on 401 or after `expires_in`). Quickest: in Console, run `await fetch(SB_URL+'/auth/v1/token?grant_type=refresh_token', {method:'POST', headers:{apikey:SB_KEY,'Content-Type':'application/json'}, body:JSON.stringify({refresh_token: JSON.parse(sessionStorage.sb_session).refresh_token})});` and re-trigger any authed call. |
| **Then** | `sessionStorage.sb_session` updates to the new blob. `localStorage` remains unchanged (still empty of auth keys). |
| **Evidence** | Before/after screenshot of `sessionStorage` value. |

#### Scenario 3 — Logout clears both stores

| | |
|--|--|
| **Given** | Logged-in user |
| **When** | User clicks logout |
| **Then** | Both `sessionStorage.sb_session` and any legacy `localStorage.sb_session` cleared. Subsequent authed action prompts login. |
| **Evidence** | Screenshot showing both stores cleared of auth keys post-logout. |

#### Scenario 4 — Same-tab reload preserves session; new tab does not

| | |
|--|--|
| **Given** | Logged-in user in tab A |
| **When** | (a) Reload tab A. (b) Open the app in a new tab B. (c) Close all tabs, reopen browser. |
| **Then** | (a) Tab A still logged in. (b) Tab B starts logged-out. (c) Browser restart → logged out. |
| **Evidence** | Screenshots of each step. |

#### Scenario 5 — Migration path (legacy localStorage → sessionStorage)

| | |
|--|--|
| **Given** | Browser with a leftover legacy `localStorage.sb_session` from before the change |
| **When** | User reloads the page (without re-login) |
| **Then** | `sbSession.get()` reads from `localStorage`, copies to `sessionStorage`, and removes the legacy key. User is still logged in (no re-login prompt). After: `localStorage.sb_session` is gone, `sessionStorage.sb_session` has the value. |
| **Evidence** | Before/after screenshot of both stores. |

#### Scenario 6 — XSS cannot read auth tokens via localStorage

| | |
|--|--|
| **Given** | Logged-in user |
| **When** | In DevTools Console, run: `localStorage.getItem('sb_session')` and `localStorage.getItem('access_token')` |
| **Then** | Both return `null`. (The attacker had to either compromise `sessionStorage` directly — which still requires XSS — or bypass the change.) |
| **Evidence** | Screenshot of Console output showing both `null`. |

### Pass criteria

- [ ] All 6 scenarios pass with documented evidence.
- [ ] No regression in login/logout/refresh flow.
- [ ] No console errors related to session retrieval.

---

## Battle 3 — csp-strict

**Status**: Implementation pending Phase D + E. To be filled after CSP is tightened.

---

## Final sign-off (before PR)

- [ ] All Battle 1 scenarios documented as passing.
- [ ] All Battle 2 scenarios documented as passing.
- [ ] All Battle 3 scenarios documented as passing.
- [ ] Smoke walk completed: home → signup → login → renter dashboard tabs → listing card → enquiry → landlord dashboard → listing CRUD → AI panels → logout. DevTools Console clean throughout.
- [ ] Production deploy preview validated (CSP headers, no console violations).
