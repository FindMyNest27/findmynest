# Proposal: Security Hardening — Phase 0 (Critical + High Risk Bundle)

## Intent

Close four pre-launch blockers identified in `docs/agent-analysis/reports/2026-05-02-informe-vulnerabilidades-y-plan-remediacion-es.md` (Fase 0) and Block 3 of `2026-05-02-propuesta-etapa-2-no-tecnica-es.md`: DOM XSS via unsanitized `innerHTML`, auth tokens persisted in `localStorage`, a permissive CSP (`'unsafe-inline'` + inline handlers), and Edge Function calls missing `Authorization: Bearer`. Each is independently sufficient to compromise renter/landlord accounts; together they make the SPA unsafe to launch in Stage 2.

## Scope

### In Scope
- Audit and remediate all `innerHTML` writes with dynamic data (`index.html`, 85 hits combined `innerHTML`/`localStorage`); replace with `textContent` / `createElement` or enforce `esc()` consistently.
- Move auth tokens (`access_token`, `refresh_token`) out of `localStorage` (`index.html:2180,2191,2204,2215`).
- Migrate inline `onclick=` handlers (85 occurrences) to `addEventListener`; remove `'unsafe-inline'` from `script-src` in `vercel.json:8`.
- Add `Authorization: Bearer <jwt>` to authenticated Edge Function calls (`index.html:2382,3123,4587,4682`); never trust client-sent IDs (`renter_id: u.auth_id`, `index.html:3128`).
- Manual verification checklist with documented evidence (devtools, `rg`, `curl -I`).

### Out of Scope
- Supabase RLS policy review (separate change — dashboard-side).
- Edge Function server code changes (separate Supabase project; cross-system dependency).
- GitHub Actions FTP → SFTP/FTPS migration (separate Phase 0 item, distinct concern).
- Refactor to a build system or framework.

## Capabilities

### New Capabilities
- `client-xss-defense`: Centralized DOM-write policy and helpers preventing untrusted strings from reaching `innerHTML`.
- `auth-token-storage`: Browser-side session storage model that keeps tokens out of `localStorage`.
- `csp-strict`: Strict Content-Security-Policy without `'unsafe-inline'` for `script-src`.
- `edge-fn-client-auth`: Client-side contract for calling Supabase Edge Functions with JWT-derived identity.

### Modified Capabilities
- None (no existing `openspec/specs/` to amend; this is the first change).

## Approach

Single PR, four sequential commits (one per battle), gated by a manual security checklist. Battle 1 first (highest blast radius, lowest UX risk). Battle 2 next, since (3) and (4) depend on a stable session model. Battle 3 after handlers are migrated. Battle 4 last, once `getSession()` reliably returns a JWT. Specific storage strategy (in-memory + refresh cookie vs. `sessionStorage` rotation vs. SDK-native) deferred to `sdd-design`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `index.html:1925` (`esc()`) | Reuse | Existing helper is correct; centralize usage |
| `index.html:2540,2541,2635,2636,2643,2777,2781,3054,3818,3809,3972,4599,4705,4587,4682` | Modified | `innerHTML` writes with dynamic data — replace or sanitize |
| `index.html:1978-1980,2180,2191,2204,2215` | Modified | Token + user state storage |
| `index.html` (all `onclick=` sites, ~85) | Modified | Move to `addEventListener` |
| `index.html:2382,3123,4587,4682` | Modified | Add `Authorization: Bearer` + JWT-derived identity |
| `vercel.json:8` (CSP) | Modified | Remove `'unsafe-inline'` from `script-src` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Auth flow breaks (refresh, persistence across reload) | High | Stage Battle 2 behind a manual login/logout/reload checklist; rollback by reverting commit |
| Inline handler migration misses a node; UI button silently dead | Med | `rg "onclick=|onsubmit=|onchange="` after migration must return 0 |
| Strict CSP blocks a legitimate third-party (fonts/Formspree) | Med | Keep existing `connect-src`/`font-src`/`style-src`; only `script-src` tightens |
| Edge Function call regression (anon calls becoming 401) | Med | Coordinate with Supabase Edge Function update (cross-system); flag in checklist |
| XSS regression slips back in via new feature work | Med | Add a `## Project Standards` rule: no new `innerHTML` with dynamic data |

## Rollback Plan

Each battle is one commit. If a battle regresses, revert that commit only:
- Battle 1: `git revert <sha-1>` — UI text rendering returns to current behavior; XSS risk re-opens but auth still works.
- Battle 2: `git revert <sha-2>` — tokens go back to `localStorage`; users may need to re-login.
- Battle 3: `git revert <sha-3>` — restores `'unsafe-inline'` and inline handlers; CSP relaxes but functional.
- Battle 4: `git revert <sha-4>` — Edge calls revert to current headers; cross-system Edge changes (if shipped) need their own rollback.

Vercel preserves the previous static build for instant rollback at the platform level if a deploy-time CSP misconfiguration breaks the SPA.

## Dependencies

- Supabase Edge Functions (`send-email`, `submit-enquiry`, `rent-estimate`, `flatmate-match`) MUST validate `Authorization: Bearer` and derive identity via `auth.uid()` rather than client payload. Coordinate ship order with Edge Function update.
- Supabase RLS audit (separate change) is the second line of defense; this change does NOT substitute for RLS.
- No new tooling: vanilla JS + existing `esc()` only.

## Success Criteria

- [ ] `rg "innerHTML\s*=\s*[^;]*\+|innerHTML\s*=\s*`" index.html` returns 0 hits with un-`esc()`'d dynamic data.
- [ ] `rg "localStorage\.setItem\(.*(access_token|refresh_token|sb_session|recovery)" index.html` returns 0 hits.
- [ ] `rg "onclick=|onsubmit=|onchange=" index.html` returns 0 hits.
- [ ] `curl -sI https://<deploy>/ | rg -i "content-security-policy"` shows `script-src 'self'` without `'unsafe-inline'`.
- [ ] Every `fetch(SB_URL + '/functions/v1/...')` for authenticated actions includes `Authorization: Bearer ${session.access_token}` header.
- [ ] Manual checklist executed and evidence (screenshots, header dumps, `rg` outputs) captured in `verify-report.md`.
- [ ] Login / signup / logout / refresh / dashboard load all pass post-change smoke test.
