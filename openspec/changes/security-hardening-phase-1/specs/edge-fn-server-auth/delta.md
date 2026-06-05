# Delta: edge-fn-server-auth

- **Capability**: `edge-fn-server-auth`
- **Delta type**: `create`

## Change Description

Introduce a new spec that enforces server-side JWT validation (`verify_jwt`) on `submit-enquiry`, `rent-estimate`, and `flatmate-match`, and mandates that `submit-enquiry` and `flatmate-match` derive caller identity exclusively from `auth.uid()` (via `supabase.auth.getUser(jwt)`) rather than from any client-supplied field in the request body. This nullifies the service-role-behind-no-auth vulnerability and the client-asserted-identity vulnerability surfaced in the proposal.

## Affected Files

- `supabase/functions/submit-enquiry/index.ts` — `verify_jwt: true`; identity from `auth.uid()` + DB lookup; ignore `renter_id` body field
- `supabase/functions/rent-estimate/index.ts` — `verify_jwt: true`
- `supabase/functions/flatmate-match/index.ts` — `verify_jwt: true`; identity from `auth.uid()` + DB lookup; ignore `renter` body PII fields

## Out of Scope (Cross-System)

- `send-email` is pre-auth by design; `verify_jwt` does NOT apply to it (phishing defense is governed by `email-phishing-defense`).
- Supabase RLS policy review (separate dashboard-side change).
- Client-side `Authorization: Bearer` header changes (governed by `edge-fn-client-auth`).
- DB schema changes beyond the existing `auth_id`→renter-profile join (no migration anticipated).
