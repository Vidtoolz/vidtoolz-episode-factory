# PRESTO LLM reroute — independent WIP preservation

This non-production branch was created from `f8eb499d4891ac087bf8986a92f1a7319cae6b2a` to keep unrelated routing work out of Earth Studio authorities.

It preserves exactly the dirty changes to:

- `package-engine-server.js`;
- `docs/idea-engine.md`;
- `docs/super-focus.md`;
- `tests/media-routing.test.js`;
- `tests/super-focus-routing-integration.test.js`.

The changes route default/high-quality local LLM calls toward PRESTO and update related model expectations. This preservation commit makes no decision about operational validity or production promotion. Independent routing review remains required.

The original bytes are also retained in `/home/vidtoolz/episode-factory-preservation/2026-09-02-pre-parser-bypass/`.
