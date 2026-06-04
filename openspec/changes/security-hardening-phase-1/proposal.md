# Proposal: Security Hardening — Phase 1 (Edge Function Server-Side Auth — Battle 4)

## Intent

Battle 4 of `security-hardening-phase-0` was DEFERRED because the user did not have the Supabase Edge Function server-side source, and adding a client-side `Authorization: Bearer` header without server-side JWT validation is **security theater** — the real defense lives server-side. That blocker is now RESOLVED: the four Edge Function sources are in hand. This change formalizes Battle 4 as a standalone change so the server-side defenses ship correctly.

Reading the real source surfaced issues worse than the phase-0 client-only audit could see. Ordered by severity:

1. **Hardcoded live API keys (systemic).** A live Resend key (`re_***`) is hardcoded in BOTH `send-email` and `submit-enquiry`. A live Groq key (`gsk_***`) is hardcoded in `rent-estimate`. Anyone reading the function source (or a leaked deploy) can send mail from the `findmynest.co.nz` domain and burn Groq credits directly, bypassing Supabase entirely. The Anthropic key is already correctly read via `Deno.env.get('ANTHROPIC_API_KEY')` — that is the pattern to replicate everywhere.
2. **`send-email` is a ready-made phishing relay.** `send-email` is **PRE-auth** (signup/recovery flows — the caller has no session). For `type:'signup'`, `resetLink = client confirmationUrl` → an attacker controls BOTH the recipient address AND the link `href`, delivered inside a FindMyNest-branded email signed with the domain's SPF/DKIM reputation. That is brand-spoofing phishing, not mere spam. **Correction to memory #960:** phase-0 classified `send-email` as "private/logged-in" — that was WRONG. The call site (`index.html` `sendEmail` L2553) proves it is inherently pre-auth. The generic `auth.uid()` recipe does NOT apply here.
3. **`SERVICE_ROLE` behind no auth.** `submit-enquiry`, `rent-estimate`, and `flatmate-match` use the Supabase service-role key, which **bypasses Row Level Security**. With no verified caller, RLS is silently nullified and the client is trusted to assert its own identity (`submit-enquiry` trusts a client-supplied `renter_id`; `flatmate-match` accepts full renter PII in the request body). Service-role MUST sit behind verified auth.
4. **Cost-amplification on open functions.** `submit-enquiry` (Anthropic), `rent-estimate` (Groq llama-8b), and `flatmate-match` (Groq) all invoke paid LLMs with no auth gate — anyone can drive spend. `rent-estimate` (L4748) currently sends NO headers at all (not even the anon apikey): it is fully open.

Success looks like: zero hardcoded secrets, no client-asserted identity on authenticated functions, `send-email` incapable of relaying an attacker-controlled link, and every paid LLM function gated by a JWT that Supabase validates server-side — all using ONLY the existing Supabase JWT (no captcha, no new rate-limit infrastructure).

## Scope

### In Scope
- Import the four Edge Function sources into `supabase/functions/{send-email,submit-enquiry,rent-estimate,flatmate-match}/index.ts` **with all secrets stripped to `Deno.env.get`** — never commit a key inline.
- Move ALL secrets (Resend, Groq) to `Deno.env.get` + `supabase secrets set`; confirm the already-rotated keys are wired through env.
- Tighten CORS on all four functions from `Access-Control-Allow-Origin: '*'` to `https://www.findmynest.co.nz`.
- Enforce `verify_jwt` server-side on `submit-enquiry`, `rent-estimate`, and `flatmate-match`.
- Derive caller identity server-side via `supabase.auth.getUser(jwt)` / `auth.uid()` for `submit-enquiry` and `flatmate-match`; ignore client-supplied `renter_id` / `renter` body fields entirely.
- Harden `send-email` (pre-auth): ALWAYS generate the link server-side via `admin.generateLink` (already done for recovery — extend to signup); NEVER trust client `confirmationUrl`; lean on Supabase Auth's native rate-limiting.
- Client (`index.html`): add `Authorization: Bearer ${session.access_token}` to the `submit-enquiry` (L3291) and `flatmate-match` (L4856) calls; ensure `rent-estimate` (L4748) sends the project JWT.
- Manual verification checklist with documented evidence (`curl` against deployed functions, secret-presence checks, anon-call rejection proofs).

### Out of Scope
- **No captcha / Turnstile / hCaptcha.** The constraint is to use ONLY the existing Supabase JWT.
- **No new rate-limit infrastructure** (no rate-limit table, no Redis, no per-IP counters). `send-email` leans on Supabase Auth's native rate-limiting; the JWT-gated functions are protected by auth, not a custom limiter.
- **No DB migrations** beyond what is strictly required to derive identity (the `auth_id`→profile lookup already exists; no schema change anticipated).
- Supabase RLS policy review (separate, dashboard-side change — still the second line of defense).
- Frontend XSS / token-storage / CSP work (shipped in `security-hardening-phase-0`).
- Refactor to a build system or framework.

## Capabilities

### New Capabilities
- `edge-fn-secret-hygiene`: All Edge Function secrets sourced from `Deno.env.get` + `supabase secrets`, never inline; CORS locked to the production origin.
- `edge-fn-server-auth`: Server-side `verify_jwt` + identity derived from `auth.uid()` (never client payload) for authenticated functions running under `SERVICE_ROLE`.
- `email-phishing-defense`: `send-email` always generates links server-side via `admin.generateLink`; client `confirmationUrl` is never trusted.

### Modified Capabilities
- `edge-fn-client-auth` (from phase-0): the client contract is completed — the `Authorization: Bearer` header now has a real server-side validator behind it, removing the security-theater gap phase-0 explicitly flagged.

## Approach

Ship as scoped, sequenced work units B4.0–B4.5. B4.0 is blocking and cross-cutting: nothing else matters while live keys remain readable, so secrets-to-env + CORS land first across all four functions. Then the JWT work, highest-ROI first (`flatmate-match` and `submit-enquiry` are already post-login, so the fix is zero UX cost). `rent-estimate` stays public but turns `verify_jwt` ON (proportional: no PII, cheap llama-8b). `send-email` last, extending the existing server-side link generation to the signup flow. Client header changes (B4.4) ship together with their server-side validators so a header is never added without a validator behind it.

| Phase | Function(s) | Work |
|-------|-------------|------|
| **B4.0** (blocking, cross-cutting) | all four | Rotate Resend + Groq (done in dashboards by user); move ALL secrets to `Deno.env.get` + `supabase secrets set`; tighten CORS `'*'` → `https://www.findmynest.co.nz`. Replicate the existing Anthropic `Deno.env.get` pattern. |
| **B4.1** | `flatmate-match` | Require user JWT; derive renter from `auth.uid()` + DB lookup; IGNORE client `renter` body. Highest ROI, zero UX cost. |
| **B4.2** | `submit-enquiry` | Require user JWT; derive `renter_id` from `auth.uid()`; IGNORE client `renter_id` field. `SERVICE_ROLE` now sits behind verified auth. |
| **B4.3** | `rent-estimate` | Stays public but `verify_jwt` ON (today it sends nothing). No captcha, no rate-limit table. |
| **B4.4** | `index.html` | Add `Authorization: Bearer ${session.access_token}` to `submit-enquiry` (L3291) + `flatmate-match` (L4856); ensure `rent-estimate` (L4748) sends the project JWT. Ships with B4.1–B4.3 validators. |
| **B4.5** | `send-email` | Pre-auth: NEVER trust client `confirmationUrl`; ALWAYS `admin.generateLink` server-side (extend the existing recovery behavior to signup). Lean on Supabase Auth native rate-limiting. |

Specific server-side identity-lookup query shape and the exact `admin.generateLink` signup-link wiring are deferred to `sdd-design`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/send-email/index.ts` | New (imported) | Secrets → env; CORS lock; server-side link generation for signup |
| `supabase/functions/submit-enquiry/index.ts` | New (imported) | Secrets → env; CORS lock; `verify_jwt`; identity from `auth.uid()` |
| `supabase/functions/rent-estimate/index.ts` | New (imported) | Secret → env; CORS lock; `verify_jwt` ON |
| `supabase/functions/flatmate-match/index.ts` | New (imported) | Secret → env; CORS lock; `verify_jwt`; identity from `auth.uid()` |
| `index.html:3291` (`submit-enquiry` call) | Modified | Add `Authorization: Bearer`; stop sending `renter_id` as identity |
| `index.html:4856` (`flatmate-match` call) | Modified | Add `Authorization: Bearer`; stop sending PII as identity source |
| `index.html:4748` (`rent-estimate` call) | Modified | Send project JWT |
| `index.html:2553` (`sendEmail` call) | Reviewed | Pre-auth; client `confirmationUrl` no longer trusted server-side |
| Supabase secrets store | Modified | `RESEND_API_KEY`, `GROQ_API_KEY` set via `supabase secrets set` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Client `Authorization` added without server validator → security theater (the phase-0 gap) | High if mis-sequenced | B4.4 client headers ship together with B4.1–B4.3 server validators; never a header without a validator |
| `verify_jwt` ON breaks a legitimate call (401) for an action that was silently anonymous | Med | Verify call sites send a JWT before flipping `verify_jwt`; smoke-test enquiry + flatmate-match + rent-estimate post-deploy |
| `auth.uid()` lookup fails to resolve the renter profile (auth_id mismatch) | Med | Confirm `auth_id`→profile join in `sdd-design`; reject with explicit 403 rather than falling back to client field |
| Committing a function file with a key still inline | Low but severe | Import with `Deno.env.get` only; pre-commit `rg "re_|gsk_"` over `supabase/functions/` must return 0 |
| `admin.generateLink` signup change alters the signup email link format | Med | Test the full signup → email → confirm loop; the link is now server-generated, not client-supplied |
| Secrets not yet provisioned in the target env → function 500s | Med | `supabase secrets set` before deploy; checklist verifies presence |

### UX & Operational Impact
- **`flatmate-match` + `submit-enquiry`**: callers are ALREADY post-login (`if(!u) return` / logged-in renter), so requiring the JWT they already hold is **zero UX cost**.
- **`rent-estimate`**: stays public — no login wall added; `verify_jwt` uses the project/anon JWT, so discovery UX is unchanged.
- **`send-email`**: the signup confirmation link becomes server-generated. The user-visible flow is the same; only the link's origin changes (client-supplied → `admin.generateLink`).

## Rollback Plan

Each work unit is an independent commit; server functions and client live in the same repo but deploy separately (Supabase CLI vs. Vercel static), so coordinate ship order: deploy server validators BEFORE client header changes, roll back client BEFORE server.

- **B4.0**: reverting reintroduces hardcoded keys — DO NOT roll back B4.0 in isolation; rotate again instead. Secrets-in-env is a one-way ratchet.
- **B4.1 / B4.2 / B4.3**: `git revert` the function change AND redeploy the prior function build; client falls back to anonymous calls.
- **B4.4** (client): `git revert` restores prior headers; Vercel preserves the previous static build for instant platform-level rollback.
- **B4.5** (`send-email`): revert restores prior server-side link logic; the signup link reverts to the prior generation path.

## Dependencies

- Supabase CLI access to deploy `supabase/functions/*` and run `supabase secrets set`.
- Resend + Groq keys already rotated in their dashboards (done by user); this change wires the new values through env only — it never writes the values into the repo.
- The existing `auth_id`→renter-profile relationship in the database (used to derive identity from `auth.uid()`); no schema change anticipated.
- Supabase Auth native rate-limiting (relied on for `send-email`, not built here).
- No new tooling, no captcha provider, no rate-limit store.

## Open Questions

- **`rent-estimate` — public vs. gated?** Current policy keeps it public with `verify_jwt` ON (proportional: no PII, cheap llama-8b, no rate-limit table). The user may later decide market insight should require login. If so, that is a follow-up policy flip (require an authenticated user JWT + `auth.uid()` check), not part of this change's committed scope.

## Success Criteria

- [ ] `rg "re_[A-Za-z0-9]|gsk_[A-Za-z0-9]" supabase/functions/` returns 0 hits (no inline secrets).
- [ ] All four functions read their keys via `Deno.env.get(...)`; `supabase secrets list` shows `RESEND_API_KEY` and `GROQ_API_KEY`.
- [ ] CORS on all four functions returns `Access-Control-Allow-Origin: https://www.findmynest.co.nz`, not `*`.
- [ ] Anonymous `curl` to `submit-enquiry`, `flatmate-match`, and `rent-estimate` (no JWT) is rejected (401) — proves `verify_jwt` is ON.
- [ ] `submit-enquiry` and `flatmate-match` derive identity from `auth.uid()`; supplying a forged `renter_id`/`renter` body does NOT change the resolved identity.
- [ ] `send-email` with an attacker-supplied `confirmationUrl` ignores it and emails a server-generated `admin.generateLink` URL for both signup and recovery.
- [ ] Client `submit-enquiry` (L3291) and `flatmate-match` (L4856) calls include `Authorization: Bearer ${session.access_token}`; `rent-estimate` (L4748) sends the project JWT.
- [ ] Signup / recovery email loop, enquiry submission, flatmate match, and rent estimate all pass post-change smoke test.
- [ ] Manual checklist executed and evidence (header dumps, anon-call rejections, secret-presence checks) captured in `verify-report.md`.
