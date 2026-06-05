# Delta: auth-token-storage

- **Capability**: `auth-token-storage`
- **Delta type**: `create`

## Change Description

Introduce a new spec that prohibits writing Supabase auth tokens (`access_token`, `refresh_token`, recovery tokens, full `sb_session`) to `window.localStorage`. The concrete storage mechanism (in-memory, `sessionStorage`, or `httpOnly` cookie) is deferred to `sdd-design`. The spec only governs the prohibition and the observable login/refresh/logout/reload behaviors.

## Affected Files

- `index.html:1978-1980` — current user-state hydration from `localStorage`.
- `index.html:2180, 2191, 2204, 2215` — current `localStorage.setItem` calls for tokens / session state.
- `index.html` (any other auth bootstrap path) — must read from the new storage strategy decided in design.
