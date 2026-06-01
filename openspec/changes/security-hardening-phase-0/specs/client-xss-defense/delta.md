# Delta: client-xss-defense

- **Capability**: `client-xss-defense`
- **Delta type**: `create`

## Change Description

Introduce a new spec that codifies the client-side rule: every dynamic DOM write MUST sanitize via `esc()` or use safe DOM APIs (`textContent`, `createElement` + `appendChild`). No existing spec exists for this capability.

## Affected Files

- `index.html` — all `innerHTML` writes carrying dynamic data, notably around lines `2540, 2541, 2635, 2636, 2643, 2777, 2781, 3054, 3818, 3809, 3972, 4599, 4705, 4587, 4682`.
- `index.html:1925` — existing `esc()` helper is the canonical sanitizer; no signature change.
