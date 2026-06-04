# Deploy Runbook — Security Hardening Phase 1 (Edge Function auth)

**For: the Supabase project Owner/Admin** (these steps require Owner/Admin role on project `vbkmfloxweczyvpfbsdh`).
**Branch with the code:** `feature/security-hardening-phase-1`

## What this is / why
The 4 Supabase Edge Functions (`send-email`, `submit-enquiry`, `rent-estimate`, `flatmate-match`) were hardened:
- API keys (Resend, Groq) moved out of the source code into env secrets.
- Server-side JWT auth added: identity is now derived from `auth.uid()`, never trusted from the request body.
- `send-email` no longer sends signup emails (relayed an attacker-controllable link) — signup confirmation moves to Supabase's native email.
- CORS locked to `https://www.findmynest.co.nz`.

The code is done and reviewed. These deploy steps make it live. **Until deployed, production is unchanged (insecure).**

---

## Prerequisites
```bash
brew install supabase/tap/supabase     # if not installed
supabase login                         # log in as the Owner/Admin account
supabase link --project-ref vbkmfloxweczyvpfbsdh
git checkout feature/security-hardening-phase-1   # the CLI deploys from supabase/functions/ in this branch
```

---

## Step 1 — Set the Edge Function secrets
Get the current key VALUES from the existing (still-deployed) function source in the Supabase dashboard
(Edge Functions → each function → they are hardcoded at the top), or from the Resend / Groq dashboards.

```bash
supabase secrets set RESEND_API_KEY=<resend-key> GROQ_API_KEY=<groq-key>
supabase secrets list     # confirm RESEND_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY are present
```
- If `ANTHROPIC_API_KEY` is not listed, add it too (used by `submit-enquiry`).
- Do NOT set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase injects these automatically.

---

## Step 2 — Native signup email (replaces the removed custom signup email)
`send-email` no longer handles signup, so Supabase Auth must send the confirmation email.

**a) Authentication → Emails → SMTP Settings → enable Custom SMTP** (using Resend):
```
Host:         smtp.resend.com
Port:         465
Username:     resend
Password:     <resend-key>            (same Resend API key)
Sender email: noreply@findmynest.co.nz
Sender name:  FindMyNest
```
**b) Authentication → Email Templates → "Confirm signup"** → paste the FindMyNest branded HTML.
**c) Authentication → Providers → Email** → ensure **"Confirm email" is ON** (otherwise no confirmation email is sent).

---

## Step 3 — Deploy the functions
```bash
supabase functions deploy send-email submit-enquiry rent-estimate flatmate-match
```
This reads `verify_jwt` per function from `supabase/config.toml` automatically.

> **Order matters:** Step 1 (secrets) MUST be done before deploy, or the functions return 500 on an empty key.

---

## Step 4 — Coordinate the frontend deploy (CRITICAL)
The client (`index.html` + `vercel.json`) on this branch was changed to send the JWT and the new request bodies.
**Server and client must go live together.** Deploying only the functions makes the old production client fail
(401 / 400) until the new frontend is live, and vice versa.

- Deploy the functions (Step 3) and the frontend (merge/deploy the branch to Vercel) **back-to-back**.
- Prefer a **low-traffic window**.

---

## Step 5 — Verify after deploy
```bash
# No JWT → must be rejected (proves verify_jwt is on)
curl -i -X POST https://vbkmfloxweczyvpfbsdh.supabase.co/functions/v1/submit-enquiry \
  -H "Content-Type: application/json" -d '{"listing_id":1,"message":"test"}'
# Expected: HTTP 401
```
Then smoke-test in the app: signup (gets native confirmation email), password recovery,
submit an enquiry, flatmate compatibility, rent estimate — all should work for a logged-in user.

---

## Schema assumptions to confirm (the functions read these)
- `renters` has `name` and `phone` columns (used in the enquiry email).
- `enquiries` has all columns the insert uses, including `ai_score`, `ai_summary`, `ai_reasoning`, `ai_positives`, `ai_concerns`, `pm_email`, `listing_*`, `renter_*`.
- `flatmate_profiles` is keyed by `email`.
- `room_listings` has the fields used in the prompt (`rent_per_week`, `room_type`, etc.).

## Known fast-follows (not blocking; track separately)
- `rent-estimate` is public (gated only by the anon JWT) — consider a rate limit later to cap LLM cost.
- Client error responses return a generic message; internal detail is logged server-side.

## Security note
The two API keys (Resend, Groq) were previously hardcoded in the function source. This change removes them from
the code. If there is ANY chance the old source leaked, rotate both keys (Resend + Groq dashboards) and update the
secrets in Step 1 with the new values — that is the only thing that invalidates a leaked key.
