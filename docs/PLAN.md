# STRATA — Implementation Plan

Constraints that shape everything: no frontend framework, TypeScript for all logic, Canvas 2D for
the playfield, native `WebSocket` for versus, a service worker plus IndexedDB for offline play, and
no external runtime dependencies (fonts are self-hosted, all art and audio is generated in code).

## Architecture at a glance

```
src/engine/     pure game rules: board, pieces, SRS, bag, scoring, gravity, game state machine
src/render/     Canvas 2D presentation + a narrow drawing interface shared with tools/render-preview
src/input/      keyboard, pointer/touch, DAS/ARR translation, binding storage
src/audio/      WebAudio synthesis (effects + original music), no asset files
src/ui/         DOM screens, HUD, dialogs, focus management, navigation
src/storage/    IndexedDB (structured) + localStorage (small values) with typed repositories
src/net/        WebSocket client, protocol codecs, match state
src/sw/         service worker + cache policy
shared/         protocol types shared by client and server
server/         Node + ws multiplayer backend (runs on Node's native TypeScript stripping)
tools/          build-time helpers: headless PNG preview renderer, build integrity checks
test/           unit (engine, scoring, net), host (DOM/UI/storage/SW), net (client<->server)
e2e/            Playwright specs (keyboard, touch, resize, pause, offline)
```

`src/engine` must not import anything from DOM, `render`, `ui`, `audio`, `storage` or `net`. A unit
test (`test/unit/engine-boundary.test.ts`) enforces this by reading the source files and asserting
they contain no DOM/Canvas/`window`/`document` references.

## Milestones

**M1 — Research and plan (this document, `RESEARCH.md`, `RULESET.md`).**
Sources fetched and classified; explicit rules profile chosen; module layout fixed.

**M2 — Engine.**
`rng` → `pieces`/`rotation` → `board` → `gravity`/`scoring`/`tspin` → `bag` → `game` state machine.
Acceptance: the whole unit suite for pieces, spawn positions, collisions, SRS kicks (including
T-spin triple and I-piece kicks), bag distribution, hold limits, drops, clears/compaction, scoring,
B2B/combo/perfect clears, level progression, lock delay with the 15-reset cap, top-out reasons.

**M3 — Interface.**
Canvas renderer with a scene model, HUD, menus, mode select, settings, key rebinding, pause and
end-of-game screens, responsive layout, touch controls, reduced-motion and contrast options.
Acceptance: `tools/render-preview.ts` renders board states to PNGs with the same drawing code the
browser uses (this is how the art was reviewed without a browser engine in the sandbox); the host
suite drives the DOM screens in happy-dom, including keyboard input, pause/resume, game over and
turning off the canvas path for `prefers-reduced-motion`.

**M4 — Offline.**
Service worker with a build-generated precache manifest, versioned caches, offline fallback for
navigation requests, update prompt, plus IndexedDB repositories for settings, records and stats.
Acceptance: cache-policy unit tests; a build-integrity test that resolves every manifest entry
against the real `dist/`; an offline reload simulation in happy-dom.

**M5 — Versus.**
`/server` Node + `ws` backend: quick matchmaking, private rooms with 5-character codes, ready-up
and a synchronised countdown, attack/cancellation bookkeeping, garbage-hole generation, heartbeats,
disconnect/timeout handling, reconnection by token, rate limiting and message validation.
Client: connection screen, opponent board mirror, attack indicators, result and rematch flow.
Acceptance: protocol codec unit tests, attack-table tests, and integration tests that start the
real server and drive real `ws` clients through matchmaking, a full match, malformed packets and
reconnection.

**M6 — Testing and polish.**
Fill coverage gaps, add the Playwright specs, write the README and the architecture/limitations
documents, run the full check pipeline, and start the app locally to verify the dev server and the
production preview both serve a working game.

## Testing strategy

* Unit tests cover rules exhaustively and are the primary safety net; the engine is deterministic
  and driven by explicit `update(dt)` calls, so no test needs fake timers or a browser.
* Host tests use happy-dom and fake-indexeddb to exercise DOM, storage and UI wiring.
* Network tests start the actual server on an ephemeral port and speak the real protocol.
* Playwright specs exist for genuine browser coverage but need a local browser download, which this
  sandbox cannot reach; `docs/FEATURES.md` states exactly which checks were run here.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Rule ambiguity between game versions | One documented profile; every deviation flagged in `RULESET.md`; no mixing of tables |
| Frame-rate dependent physics | Engine advances on milliseconds, host clamps `dt` to 100 ms, all timing in ms |
| Canvas DPI blur on retina | Renderer measures `devicePixelRatio` and sizes the backing store accordingly |
| Huge `dt` after tab switch | Clamp + "was hidden" handling that pauses single-player modes |
| Cheating in versus | Documented as a limitation; the server validates and rate-limits, and *all* attack and
garbage math is server-side, but there is no authoritative simulation |
| Stale service worker locking users out | Explicit update prompt, `skipWaiting` only on user action, versioned caches |
