# Browser authenticity oracle

Only explicit `http:`/`https:` targets are eligible. Loopback is denied except exact deterministic fixture ports; admin/debug/control endpoints remain denied. Credentials in URLs, `file:`, `javascript:`, `data:`, `chrome:`, and `about:` are rejected. Redirects must be enumerated. Authentication requirements surface rather than fabricate success.

Acceptance binds requested/final URL, fresh capture id/time/cache state, exact visible selector and area, and a state nonce visibly present in raw pixels. The harness runs a real headless Chrome capture against a local deterministic server and separately rejects wrong/hidden selector, stale cache, unexpected redirect, wrong page, auth required, and missing state nonce.
