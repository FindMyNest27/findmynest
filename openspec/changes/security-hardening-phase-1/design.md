# Design: Security Hardening — Phase 1 (Edge Function Server-Side Auth — Battle 4)

## Technical Approach

Import the four Edge Functions into `supabase/functions/*/index.ts` written secret-free from the first commit, then layer server-side auth on top. B4.0 (secrets→env + CORS) is cross-cutting and lands first. Identity-bearing functions (`submit-enquiry`, `flatmate-match`) move from client-asserted identity to JWT-derived identity. `rent-estimate` stays public but turns `verify_jwt` ON. `send-email` (pre-auth) drops all trust in the client `confirmationUrl`. Client header changes ship WITH their server validators (proposal B4.4), never before. Maps directly to proposal phases B4.0–B4.5 and capability `edge-fn-secret-hygiene` / `edge-fn-server-auth` / `email-phishing-defense`.

## Architecture Decisions

### ADR-1: Identity derivation — validate JWT with anon client, then write with SERVICE_ROLE

| Option | Tradeoff | Decision |
|--------|----------|----------|
| A. One client built with the request `Authorization` header; rely on RLS for the write | Cleanest, but the functions today depend on SERVICE_ROLE reads/writes; enabling RLS correctly is out of scope and risks breaking the insert | Rejected for now |
| B. Two clients: an **auth client** (anon key + request JWT) ONLY to call `getUser(jwt)`; the existing **service client** (SERVICE_ROLE) for the DB work | Keeps current data-access shape; auth is verified before any service-role action | **CHOSEN** |

**Exact flow** (`submit-enquiry`, `flatmate-match`):
```
authHeader = req.headers.get('Authorization')           // "Bearer ey..."
if (!authHeader) return 401
jwt = authHeader.replace('Bearer ', '')
authClient = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: authHeader } } })
{ data: { user }, error } = await authClient.auth.getUser(jwt)
if (error || !user) return 401
// derive identity — NEVER from body
{ data: renter } = await serviceClient.from('renters').select('*').eq('auth_id', user.id).single()
if (!renter) return 403   // no fallback to client renter_id / renter object — EVER
```
`verify_jwt = true` (ADR-4) is the first gate; this in-body check is defense-in-depth. The client-supplied `renter_id` / `renter` fields are read but DISCARDED.

### ADR-2: flatmate-match `room` — re-fetch from `listings`, do not trust client room

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Keep `room` from body | Room is listing data, not the caller's identity; but a forged room lets a caller poison the LLM prompt / fabricate a match against data that isn't a real listing | Rejected |
| Re-fetch room by id from `listings` | One extra `.eq('id', room_id).single()`; guarantees the prompt is built from real listing data; consistent with `submit-enquiry`'s existing listing fetch | **CHOSEN** |

Client now sends `{ room_id }` (not the full room object). Server: `serviceClient.from('listings').select('*').eq('id', room_id).single()`. The `renter` half is already covered by ADR-1 (derived from `auth.uid()`). Net: NEITHER side of the flatmate prompt comes from the client body anymore.

### ADR-3: send-email signup link — drop custom signup email, use Supabase native confirmation (THE hard call)

The signup user is created client-side via `signUp()`; the password never reaches `send-email`, so `admin.generateLink({type:'signup'})` (which REQUIRES the password) cannot work server-side.

| Option | Tradeoff | Decision |
|--------|----------|----------|
| a. `generateLink({type:'magiclink'})` | Works without password, but a magic link logs the user in instead of confirming an email — wrong semantics, and re-introduces a server-minted login link surface | Rejected |
| b. Capture the link at `signUp()` time | `signUp()` does not return a confirmation link to the client; would need a server signup proxy = larger refactor, out of scope | Rejected |
| c. **Drop custom signup email; let Supabase Auth send its native confirmation email, branded via a custom Resend SMTP + template in the dashboard** | Supabase owns the token + link end-to-end; client `confirmationUrl` is structurally impossible to inject because `send-email` is no longer called for signup; branding preserved via dashboard SMTP/template (Resend). One-time dashboard config, no per-request server code | **CHOSEN** |
| d. Server signup endpoint that creates the user + `generateLink({type:'signup'})` | Most control, but means moving `signUp()` server-side — refactor beyond this change | Deferred follow-up |

**Result:** `send-email` keeps ONLY `type:'recovery'` (which already generates the link server-side via `admin.generateLink({type:'recovery'})` and ignores client URL — correct as-is). The `type:'signup'` branch and its client `confirmationUrl` are REMOVED. Client `sendEmail` (L2553) stops being called for signup; Supabase's native flow + dashboard-branded template takes over. This is the only way to NEVER trust client input while keeping a branded email without a larger refactor. **Flagged as the key risk** — requires dashboard SMTP/template config as a deploy step, not code.

### ADR-4: verify_jwt wiring — `supabase/config.toml` per function

`supabase/config.toml`:
```toml
[functions.submit-enquiry]
verify_jwt = true
[functions.flatmate-match]
verify_jwt = true
[functions.rent-estimate]
verify_jwt = true        # public to humans, but caller must present the project/anon JWT
[functions.send-email]
verify_jwt = false       # pre-auth signup/recovery — no session exists
```
`rent-estimate` with `verify_jwt = true` means the gateway requires SOME valid project JWT (the anon key is a JWT). Client change (L4748): add `headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }` — today it sends no headers at all. For `submit-enquiry` (L3291) and `flatmate-match` (L4856): add `'Authorization': 'Bearer ' + session.access_token` (the live user token).

### ADR-5: CORS — single fixed origin, explicit OPTIONS preflight

Single production origin, no echo-allowlist (one origin only → no need to reflect):
```ts
const CORS = {
  'Access-Control-Allow-Origin': 'https://www.findmynest.co.nz',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
```
Every response (including errors) carries `CORS`. Replaces `Access-Control-Allow-Origin: '*'` on all four functions.

### ADR-6: Secrets — `Deno.env.get` + `supabase secrets set`

`RESEND_API_KEY` (send-email), `GROQ_API_KEY` (rent-estimate, flatmate-match). `ANTHROPIC_API_KEY` already correct in `submit-enquiry` — replicate that pattern. No value ever inline. Provision: `supabase secrets set RESEND_API_KEY=re_*** GROQ_API_KEY=gsk_***` (placeholders; real rotated values set by user, never committed). Pre-commit gate: `rg "re_[A-Za-z0-9]|gsk_[A-Za-z0-9]" supabase/functions/` → 0.

## Data Flow

```
Authenticated (submit-enquiry / flatmate-match):
[client] callEdge + Authorization: Bearer <user JWT>
   → [gateway] verify_jwt=true → 401 if absent/invalid
   → [fn] getUser(jwt) → user.id → renters.eq('auth_id',user.id) → 403 if none
   → [fn] SERVICE_ROLE write (enquiry insert / listings room fetch) → LLM → response

Public (rent-estimate):
[client] Authorization: Bearer <anon JWT>
   → [gateway] verify_jwt=true → 401 if no project JWT
   → [fn] SERVICE_ROLE listings query → Groq → response

Pre-auth (send-email):
[client] type:'recovery' only → [fn] admin.generateLink(recovery) server-side → Resend
signup → NO send-email call → Supabase native confirmation email (branded SMTP)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/send-email/index.ts` | Create | Secrets→env; CORS lock; REMOVE signup branch + client `confirmationUrl`; keep server-side recovery link |
| `supabase/functions/submit-enquiry/index.ts` | Create | Secrets→env (Anthropic already env); CORS; JWT→`auth.uid()`→`renters.auth_id`; 403 on miss; discard client `renter_id` |
| `supabase/functions/flatmate-match/index.ts` | Create | Secret→env (Groq); CORS; JWT-derived renter; re-fetch room from `listings` by `room_id` |
| `supabase/functions/rent-estimate/index.ts` | Create | Secret→env (Groq); CORS; unchanged logic |
| `supabase/config.toml` | Create | `verify_jwt` per function (ADR-4) |
| `index.html:3291` | Modify | Add `Authorization: Bearer <user token>`; drop `renter_id/name/email/phone` as identity |
| `index.html:4856` | Modify | Add `Authorization`; send `{ room_id }` not full `renter`/`room` objects |
| `index.html:4748` | Modify | Add `apikey` + `Authorization: Bearer SB_KEY` |
| `index.html:2553` | Modify | Stop calling `send-email` for signup (native flow); keep recovery path |
| Supabase secrets store | Modify | `RESEND_API_KEY`, `GROQ_API_KEY` via `supabase secrets set` |
| Supabase dashboard (Auth SMTP + signup template) | Config | Brand native confirmation email (ADR-3) |

## Interfaces / Contracts

```ts
// submit-enquiry request (post-change): identity NO LONGER in body
{ listing_id: string, message: string }                 // renter_* fields ignored if sent
// flatmate-match request (post-change)
{ room_id: string }                                      // renter derived from JWT; room re-fetched
// rent-estimate request: unchanged body; gains Authorization: Bearer <anon JWT>
// send-email request: { type: 'recovery', email }       // signup branch removed
```
Error contract: `401` (no/invalid JWT, gateway or getUser), `403` (valid JWT but no renter profile), `404` (room_id not in listings).

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Manual | Anon `curl` (no JWT) → 401 on the 3 gated fns | `verify_jwt` proof |
| Manual | Forged `renter_id`/`renter` body → identity unchanged (403 if no profile) | ADR-1 proof |
| Manual | `send-email` signup attacker `confirmationUrl` → no branded link sent (branch gone) | ADR-3 proof |
| Manual | `rg "re_\|gsk_" supabase/functions/` → 0; `supabase secrets list` shows both | ADR-6 proof |
| Smoke | signup→confirm, recovery, enquiry, flatmate-match, rent-estimate end-to-end | Post-deploy |

No test runner in repo (single-file SPA); evidence captured in `verify-report.md`.

## Migration / Rollout

Ship order: deploy server functions + secrets + `config.toml` BEFORE client header changes; roll back client BEFORE server. B4.0 secrets-to-env is a one-way ratchet (rotate again rather than revert). Dashboard SMTP/signup-template config (ADR-3) is a manual deploy step gating the signup smoke test. No DB schema migration (the `auth_id`→renter relationship already exists).

## Open Questions

- [ ] ADR-3 dashboard config (Resend SMTP + branded signup template) is operational, not code — confirm the user can set it before B4.5 ships, else signup confirmation emails fall back to Supabase default styling.
- [ ] `rent-estimate` public-vs-gated remains a future policy flip (proposal Open Question), not in scope here.
