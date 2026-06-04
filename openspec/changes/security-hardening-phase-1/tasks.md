# Tasks: security-hardening-phase-1 (Edge Function Server-Side Auth — Battle 4)

---

## Review Workload Forecast

| Metric | Estimate |
|--------|----------|
| New files | 5 (`supabase/functions/send-email/index.ts`, `supabase/functions/submit-enquiry/index.ts`, `supabase/functions/rent-estimate/index.ts`, `supabase/functions/flatmate-match/index.ts`, `supabase/config.toml`) |
| Modified files | 1 (`index.html`) |
| Estimated new-file lines | ~100–200 lines × 4 functions = 400–800 lines |
| Estimated `index.html` edits | ~30–60 lines changed (4 call sites: L3291, L4856, L4748, L2553) |
| Total estimated changed lines | **430–860 lines** |
| Chained PRs recommended | **Yes** — new function files alone likely exceed 400 lines; split at B4.4 boundary (server PR1 + client PR2) |
| 400-line budget risk | **High** |
| Decision needed before apply | **Yes** — choose: (a) two PRs (server B4.0–B4.3 + B4.5, then client B4.4); or (b) single PR with `size:exception` label |

**Recommended split:**
- **PR 1 — Server** (`feature/security-phase1-server`): B4.0 + B4.1 + B4.2 + B4.3 + B4.5 (all four `supabase/functions/*/index.ts` + `supabase/config.toml`)
- **PR 2 — Client** (`feature/security-phase1-client`): B4.4 only (`index.html` call sites) — deploy AFTER PR 1 server deploy is live

---

## Dependency Graph

```
B4.0 (blocking)
  ├─► B4.1 (flatmate-match server auth)
  ├─► B4.2 (submit-enquiry server auth)
  ├─► B4.3 (rent-estimate verify_jwt)
  └─► B4.5 (send-email signup removal)

B4.1 + B4.2 + B4.3 ──► B4.4 (client headers — MUST NOT ship before validators live)

B4.4 ──► B4.6 (manual verify checklist)
```

B4.1, B4.2, B4.3, B4.5 can run in parallel once B4.0 is merged. B4.4 is blocked until B4.1–B4.3 are deployed.

---

## Phase B4.0 — Cross-cutting: Secrets → env + CORS lock (blocking)

> Capability: `edge-fn-secret-hygiene` | Type: CODE | PR: Server (PR 1)
> All other phases depend on this landing first.

- [x] **B4.0.1** Create directory structure `supabase/functions/send-email/`, `supabase/functions/submit-enquiry/`, `supabase/functions/rent-estimate/`, `supabase/functions/flatmate-match/` (or confirm they already exist in the repo).
- [x] **B4.0.2** Import `send-email` source into `supabase/functions/send-email/index.ts` with ALL secrets replaced by `Deno.env.get`: replace any inline Resend key with `Deno.env.get('RESEND_API_KEY')`. No key value ever appears in source.
- [x] **B4.0.3** Import `submit-enquiry` source into `supabase/functions/submit-enquiry/index.ts`. Replace any inline Resend key with `Deno.env.get('RESEND_API_KEY')`. `ANTHROPIC_API_KEY` is already `Deno.env.get` — verify and preserve it. No key value appears in source.
- [x] **B4.0.4** Import `rent-estimate` source into `supabase/functions/rent-estimate/index.ts`. Replace inline Groq key with `Deno.env.get('GROQ_API_KEY')`. No key value appears in source.
- [x] **B4.0.5** Import `flatmate-match` source into `supabase/functions/flatmate-match/index.ts`. Replace inline Groq key with `Deno.env.get('GROQ_API_KEY')`. No key value appears in source.
- [x] **B4.0.6** On ALL four functions: replace the `Access-Control-Allow-Origin` value with the locked CORS constant per design ADR-5:
  ```ts
  const CORS = {
    'Access-Control-Allow-Origin': 'https://www.findmynest.co.nz',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  ```
  Every response (success AND error) MUST spread `CORS` headers. Remove any `Access-Control-Allow-Origin: '*'`.
- [x] **B4.0.7** Create `supabase/config.toml` with `verify_jwt` per function per ADR-4:
  ```toml
  [functions.submit-enquiry]
  verify_jwt = true
  [functions.flatmate-match]
  verify_jwt = true
  [functions.rent-estimate]
  verify_jwt = true
  [functions.send-email]
  verify_jwt = false
  ```
- [x] **B4.0.8** **SECRET SCAN GATE (verification, code):** Run `rg "re_[A-Za-z0-9]|gsk_[A-Za-z0-9]" supabase/functions/` — MUST return 0 matches before committing. Record terminal output as evidence for `verify-report.md`.
- [x] **B4.0.9** **Static CORS audit (verification, code):** Run `rg "Access-Control-Allow-Origin.*\*" supabase/functions/` — MUST return 0 matches. Record output.
- [ ] **B4.0.10** **Operational task (CLI, non-code):** Run `supabase secrets set RESEND_API_KEY=<rotated-value> GROQ_API_KEY=<rotated-value>` against the project (values supplied by operator from dashboards — NEVER committed). Verify with `supabase secrets list` that both keys appear by name. Record redacted screenshot for `verify-report.md`.
- [x] **B4.0.11** Commit: `security(edge-fns): import functions secret-free with locked CORS`

---

## Phase B4.1 — flatmate-match: server-side JWT auth + identity from auth.uid()

> Capabilities: `edge-fn-server-auth` | Type: CODE | PR: Server (PR 1)
> Depends on: B4.0. Parallel with B4.2, B4.3, B4.5.

- [x] **B4.1.1** In `supabase/functions/flatmate-match/index.ts`, implement the two-client pattern per ADR-1:
  - Extract `Authorization` header from the request; return `401` immediately if absent.
  - Create `authClient = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: authHeader } } })`.
  - Call `authClient.auth.getUser(jwt)`; return `401` if error or no user.
  - Use `serviceClient.from('renters').select('*').eq('auth_id', user.id).single()` to resolve renter profile; return `403` if not found.
  - The client-supplied `renter` / `renter_id` body fields are READ and then DISCARDED — they MUST NOT be used in the LLM prompt or DB writes.
- [x] **B4.1.2** Implement ADR-2: the request body MUST contain `{ room_id }` (not the full room object). Fetch the room server-side: `serviceClient.from('listings').select('*').eq('id', room_id).single()`; return `404` if not found. Use the DB-fetched room in the Groq prompt, not the client-supplied room object.
- [x] **B4.1.3** Confirm `verify_jwt = true` is set in `supabase/config.toml` for `flatmate-match` (from B4.0.7).
- [x] **B4.1.4** Commit: `security(edge-fns): flatmate-match — server JWT auth + identity from auth.uid()`

---

## Phase B4.2 — submit-enquiry: server-side JWT auth + identity from auth.uid()

> Capabilities: `edge-fn-server-auth` | Type: CODE | PR: Server (PR 1)
> Depends on: B4.0. Parallel with B4.1, B4.3, B4.5.

- [x] **B4.2.1** In `supabase/functions/submit-enquiry/index.ts`, implement the two-client pattern per ADR-1 (same flow as B4.1.1):
  - Extract `Authorization` header; return `401` if absent.
  - `authClient.auth.getUser(jwt)`; return `401` on failure.
  - `serviceClient.from('renters').select('*').eq('auth_id', user.id).single()`; return `403` if not found.
  - Client-supplied `renter_id`, `renter_name`, `renter_email`, `renter_phone`, or any similar identity field is READ and DISCARDED. The resolved `renter` from the DB is the ONLY identity used for the enquiry insert and LLM prompt.
- [x] **B4.2.2** Verify that `ANTHROPIC_API_KEY` is still correctly read via `Deno.env.get('ANTHROPIC_API_KEY')` (from the import in B4.0.3) — no regression.
- [x] **B4.2.3** Confirm `verify_jwt = true` is set in `supabase/config.toml` for `submit-enquiry` (from B4.0.7).
- [x] **B4.2.4** Commit: `security(edge-fns): submit-enquiry — server JWT auth + identity from auth.uid()`

---

## Phase B4.3 — rent-estimate: enable verify_jwt

> Capabilities: `edge-fn-server-auth` | Type: CODE | PR: Server (PR 1)
> Depends on: B4.0. Parallel with B4.1, B4.2, B4.5.

- [x] **B4.3.1** In `supabase/functions/rent-estimate/index.ts`: confirm the function logic is otherwise unchanged from the import (B4.0.4). No identity derivation is required — `rent-estimate` is public and does NOT call `getUser`. The `verify_jwt = true` in `config.toml` (B4.0.7) is the sole change: the gateway enforces that some valid project JWT is present.
- [x] **B4.3.2** Confirm `verify_jwt = true` is set in `supabase/config.toml` for `rent-estimate` (from B4.0.7).
- [x] **B4.3.3** Commit: `security(edge-fns): rent-estimate — enable verify_jwt`

---

## Phase B4.5 — send-email: remove signup branch + server-side link generation (ADR-3)

> Capabilities: `email-phishing-defense` | Type: CODE + OPERATIONAL | PR: Server (PR 1)
> Depends on: B4.0. Parallel with B4.1, B4.2, B4.3.

- [x] **B4.5.1** In `supabase/functions/send-email/index.ts`, REMOVE the `type:'signup'` branch entirely — including any code path that reads `confirmationUrl` from the request body or that sends a client-supplied URL in the email body. The branch is removed, not patched.
- [x] **B4.5.2** Confirm that the `type:'recovery'` branch still calls `admin.generateLink({ type: 'recovery', email })` server-side and does NOT use any client-supplied URL. This is the existing correct behavior — verify it was preserved in the import (B4.0.2) and add a code comment: `// Link is always server-generated via admin.generateLink — client-supplied URLs are never trusted.`
- [ ] **B4.5.3** **Operational task (dashboard, non-code):** Configure Supabase Auth with a custom Resend SMTP integration and a branded signup confirmation email template in the Supabase dashboard. This replaces the removed `send-email` signup branch. This step GATES the signup smoke test (B4.6.10) — it must be completed before that test can pass. Document the configuration steps and completion in `verify-report.md`.
- [x] **B4.5.4** Static audit: `rg "confirmationUrl" supabase/functions/send-email/index.ts` MUST return 0 matches. Record output.
- [x] **B4.5.5** Commit: `security(edge-fns): send-email — remove signup branch, keep server-side recovery link`

---

## Phase B4.4 — Client: add Authorization headers (index.html)

> Capabilities: `edge-fn-client-auth` | Type: CODE | PR: Client (PR 2)
> Depends on: B4.1 + B4.2 + B4.3 DEPLOYED to Supabase (not just committed).
> This phase MUST NOT be deployed before the server validators are live.

- [ ] **B4.4.1** In `index.html` at the `submit-enquiry` fetch call (around L3291): add `'Authorization': 'Bearer ' + session.access_token` to the request headers. Remove any `renter_id`, `renter_name`, `renter_email`, `renter_phone`, or equivalent self-referential identity fields from the JSON body. Keep domain fields (`listing_id`, `message`, `landlord_id` if needed server-side).
- [ ] **B4.4.2** In `index.html` at the `flatmate-match` fetch call (around L4856): add `'Authorization': 'Bearer ' + session.access_token` to headers. Change the body to send `{ room_id }` (the listing's ID) instead of the full room object. Remove any `renter` / `renter_id` / renter PII fields from the body.
- [ ] **B4.4.3** In `index.html` at the `rent-estimate` fetch call (around L4748): add headers `{ 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }`. Before this change, L4748 sends NO headers — this is the regression baseline being fixed.
- [ ] **B4.4.4** In `index.html` at the `sendEmail` call (around L2553): CONFIRM that no `Authorization` header is added. `send-email` is pre-auth; the client call MUST remain header-free. Static audit: `rg -A5 "send-email" index.html` shows no Authorization header in the L2553 fetch options.
- [ ] **B4.4.5** Static audit: `rg "renter_id\s*:" index.html` — inspect each hit inside the `submit-enquiry` fetch body; MUST contain no self-referential identity field. Record output.
- [ ] **B4.4.6** Commit: `security(client): add Authorization headers to edge function calls`

---

## Phase B4.6 — Manual Verification Checklist

> Type: MANUAL | Depends on: B4.4 deployed (both PRs live in production).

### Secret hygiene & CORS (`edge-fn-secret-hygiene`)
- [ ] **B4.6.1** Run `rg "re_[A-Za-z0-9]|gsk_[A-Za-z0-9]" supabase/functions/` → MUST return 0. Attach terminal output to `verify-report.md`.
- [ ] **B4.6.2** Run `rg "Access-Control-Allow-Origin.*\*" supabase/functions/` → MUST return 0. Attach output.
- [ ] **B4.6.3** Run `supabase secrets list` → output MUST list `RESEND_API_KEY` and `GROQ_API_KEY` by name (values redacted). Attach redacted screenshot.
- [ ] **B4.6.4** Run CORS preflight probe: `curl -sI -X OPTIONS -H "Origin: https://www.findmynest.co.nz" <each-function-url>` → response MUST include `Access-Control-Allow-Origin: https://www.findmynest.co.nz`. Attach 4 curl outputs.
- [ ] **B4.6.5** Run foreign-origin probe: `curl -sI -X OPTIONS -H "Origin: https://evil.example.com" <any-function-url>` → response MUST NOT include `Access-Control-Allow-Origin: https://evil.example.com` or `*`. Attach output.

### JWT gate (`edge-fn-server-auth`)
- [ ] **B4.6.6** Anonymous POST to `submit-enquiry` (no JWT): `curl -s -o /dev/null -w "%{http_code}" -X POST <submit-enquiry-url> -H "Content-Type: application/json" -d '{}'` → MUST return `401`. Attach output.
- [ ] **B4.6.7** Anonymous POST to `rent-estimate` (no JWT): same curl pattern → MUST return `401`. Attach output.
- [ ] **B4.6.8** Anonymous POST to `flatmate-match` (no JWT): same curl pattern → MUST return `401`. Attach output.
- [ ] **B4.6.9** Forged identity test — `submit-enquiry`: POST with a valid JWT (attacker session) and body `{ "renter_id": "<victim-uuid>", "listing_id": "<any>", "message": "test" }`. Confirm the resulting DB enquiry row's `renter_id` matches the attacker's `auth_id`, NOT the forged value (or 403 if attacker has no renter profile). Attach DB inspection screenshot.

### Phishing defense (`email-phishing-defense`)
- [ ] **B4.6.10** **BLOCKED UNTIL B4.5.3 (dashboard config) is complete.** Trigger signup flow for a test email address. Confirm the received confirmation email contains a link from the Supabase Auth domain or `https://www.findmynest.co.nz` — NOT an arbitrary client-supplied URL. Attach inbox screenshot with link URL visible.
- [ ] **B4.6.11** Attempt to POST to `send-email` with `{ "type": "signup", "email": "test@example.com", "confirmationUrl": "https://evil.example.com" }` (no auth header). Confirm the received email (if any) does NOT contain `https://evil.example.com`. Attach inbox/response evidence.
- [ ] **B4.6.12** Recovery email regression: trigger password-reset flow. Confirm received email contains a valid server-generated recovery link. Attach inbox screenshot.
- [ ] **B4.6.13** Confirm `send-email` call without `Authorization` header returns 200 (not 401). Attach DevTools Network screenshot of the signup send-email call.

### Client headers (`edge-fn-client-auth`)
- [ ] **B4.6.14** DevTools Network: logged-in renter submits enquiry → `submit-enquiry` request headers show `Authorization: Bearer ey...`. Attach screenshot.
- [ ] **B4.6.15** DevTools Network: logged-in renter runs flatmate-match → request headers show `Authorization: Bearer ey...`; request payload shows `{ room_id: "..." }` (no renter PII). Attach screenshot.
- [ ] **B4.6.16** DevTools Network: visitor (not logged in) runs rent-estimate → request headers show `Authorization: Bearer <anon-key>`. Attach screenshot.
- [ ] **B4.6.17** Static audit: `rg -A5 "send-email" index.html` → L2553 fetch options show NO `Authorization` header. Attach terminal output.

### End-to-end smoke tests
- [ ] **B4.6.18** Full enquiry flow: logged-in renter submits an enquiry → 200 response, enquiry appears in landlord dashboard. Console clean.
- [ ] **B4.6.19** Full flatmate-match flow: logged-in renter requests match → 200 response, result displayed. Console clean.
- [ ] **B4.6.20** Rent-estimate flow (discovery, not logged in): rent estimate returns result → 200. Console clean.
- [ ] **B4.6.21** Recovery flow: request password reset → email received → link valid → password changed successfully.
- [ ] **B4.6.22** Signup flow (end-to-end): register new account → Supabase native confirmation email received (branded via dashboard SMTP) → click link → account confirmed.

---

## Sequencing Summary

| Phase | Type | Parallel with | Blocked by | PR |
|-------|------|---------------|------------|----|
| B4.0 | Code | — | nothing | PR 1 (server) |
| B4.1 | Code | B4.2, B4.3, B4.5 | B4.0 merged | PR 1 (server) |
| B4.2 | Code | B4.1, B4.3, B4.5 | B4.0 merged | PR 1 (server) |
| B4.3 | Code | B4.1, B4.2, B4.5 | B4.0 merged | PR 1 (server) |
| B4.5 | Code + Ops | B4.1, B4.2, B4.3 | B4.0 merged | PR 1 (server) |
| B4.4 | Code | — | B4.1–B4.3 DEPLOYED | PR 2 (client) |
| B4.6 | Manual | — | B4.4 deployed | post-deploy |

Deploy order (non-negotiable per proposal rollback plan):
1. Deploy PR 1 to Supabase (`supabase functions deploy` × 4 + `supabase secrets set`)
2. Verify B4.6.6–B4.6.8 (anon 401) before merging PR 2
3. Deploy PR 2 to Vercel
4. Complete B4.6 checklist
