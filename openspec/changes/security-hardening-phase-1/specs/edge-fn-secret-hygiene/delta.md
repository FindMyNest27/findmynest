# Delta: edge-fn-secret-hygiene

- **Capability**: `edge-fn-secret-hygiene`
- **Delta type**: `create`

## Change Description

Introduce a new spec that prohibits inline secrets in all four Supabase Edge Functions and locks CORS to the production origin `https://www.findmynest.co.nz`. This addresses the systemic hardcoded-key vulnerability (live Resend key `re_***` in `send-email` and `submit-enquiry`; live Groq key `gsk_***` in `rent-estimate`) discovered when the function sources became available. CORS `'*'` on all four functions also becomes `https://www.findmynest.co.nz`.

## Affected Files

- `supabase/functions/send-email/index.ts` — strip inline Resend key; CORS lock
- `supabase/functions/submit-enquiry/index.ts` — strip inline Resend key; CORS lock
- `supabase/functions/rent-estimate/index.ts` — strip inline Groq key; CORS lock
- `supabase/functions/flatmate-match/index.ts` — strip inline Groq key; CORS lock
- Supabase secrets store — `RESEND_API_KEY`, `GROQ_API_KEY` provisioned via `supabase secrets set`

## Out of Scope (Cross-System)

- Key rotation in the Resend and Groq dashboards (done by user outside this repo).
- The Anthropic key is already correctly sourced via `Deno.env.get('ANTHROPIC_API_KEY')` — no change needed there.
- JWT validation and identity derivation (governed by `edge-fn-server-auth`).
