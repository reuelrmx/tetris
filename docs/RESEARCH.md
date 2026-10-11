# STRATA — Research Report

Scope: what is officially published about modern falling-block puzzle rules, what is only
community-documented, and which choices in this codebase are our own design decisions.

Research was performed on **2026-10-11** by fetching the sources listed below. Everything in the
"Official" columns was read directly from a publisher-controlled page; everything in the
"Community-documented" columns comes from TetrisWiki, an independent community wiki, and is
labelled as such throughout the codebase and in `docs/RULESET.md`.

## 1. Sources consulted

| # | Source | Type | Used for |
| - | ------ | ---- | -------- |
| S1 | `https://play.tetris.com/games/` (The Tetris Company) | Official / publisher | Scoring table, control mapping, mode objective wording, statement that level and speed rise as lines are cleared |
| S2 | `https://tetris.wiki/Tetris_Guideline` | Community-documented | Playfield size, buffer rows, SRS reference, spawn orientation, lock delay families, hold rules, next-queue, ghost piece, colours, top-out conditions |
| S3 | `https://tetris.wiki/Super_Rotation_System` | Community-documented | Rotation states, wall-kick tables for JLSTZ and I, kick test order |
| S4 | `https://tetris.wiki/Scoring` | Community-documented | Full guideline-compatible scoring table incl. combo, back-to-back, perfect clear |
| S5 | `https://tetris.wiki/Marathon` | Community-documented | Level progression (fixed-goal = 10 lines/level), gravity curve and its tabulated values, level-20+ behaviour uncertainty |
| S6 | `https://tetris.wiki/T-Spin` | Community-documented | 3-corner detection, front/back corner refinement, Mini T-Spin rule and the "1×2 kick promotes a Mini to full" special case |
| S7 | `https://tetris.wiki/Garbage` | Community-documented | Multiplayer attack table, incoming-garbage timing, hole randomness, combo attack |
| S8 | `https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers` | Official platform docs | Install/activate lifecycle, versioned caches, `clients.claim()`, HTTPS/localhost requirement |
| S9 | `https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API` | Official platform docs | `WebSocket` / `CloseEvent` / `MessageEvent` semantics, handshake, `Sec-WebSocket-*` headers, bfcache note |

## 2. Official, publisher-published facts (S1)

* **Objective** (verbatim wording summarised): score as many points as possible by clearing
  horizontal lines of Blocks; rotate, move and drop the falling Tetriminos inside the Matrix;
  lines clear when filled with no empty spaces; as lines are cleared the level increases and
  Tetriminos fall faster; the game ends when blocks land above the top of the playing field.
* **Keyboard mapping published by the publisher**: `Esc` pause, `Z` rotate left, `↑` rotate right,
  `C` hold, `←`/`→` move, `↓` soft drop, `Space` hard drop. Controls are customisable in their
  OPTIONS menu.
* **Scoring table published by the publisher**: soft drop 1 × distance; hard drop 2 × distance;
  single 100; double 300; triple 500; T-Spin 400; four-line clear ("Tetris") 800; T-Spin single
  800; T-Spin double 1200; T-Spin triple 1600; back-to-back adds 0.5 × the Tetris or T-Spin line
  clear; all scores are multiplied by the current level.
* Modes offered on the publisher's web portal: Marathon, Gems, Mindbender (the latter two are
  non-standard variants and out of scope for this project).

## 3. Community-documented technical conventions (S2–S7)

These are described by TetrisWiki as "thought to be" the contents of the Guideline, reconstructed
from a leaked 2009 document, developer interviews and observed behaviour of shipping games. They
are **not** published by the rights holder, and games differ from them in practice. We treat them
as conventions, not law:

* **Playfield**: 10 cells wide × 20 cells tall visible, plus a hidden buffer zone above (the
  Guideline specifies 20 buffer rows; modern games spawn lower, some as low as rows 20–21).
* **Spawn**: pieces appear horizontally, flat side down, in the buffer; `I` and `O` spawn
  centred, the 3-wide pieces spawn rounded to the left.
* **Randomisation**: a 7-bag shuffles one of each tetromino; bags are consumed in order.
* **Hold**: one stored piece; swapping is locked out until the active piece locks.
* **Next queue**: Guideline games show up to six previews in spawn orientation.
* **Ghost piece**: non-interactive landing-position aid, sometimes toggleable.
* **Lock down**: three families — infinite reset, extended placement (move reset, capped at 15
  moves/rotations) and classic (step reset). Later Guideline games use move reset only. 0.5 s
  base lock delay.
* **Timings recommended (non-mandatory)**: DAS ≈ 167 ms (30 Hz-ish), ARR ≈ 33 ms (30 Hz),
  ARE ≈ 100 ms.
* **Top-out**: a piece spawns overlapping existing blocks, a piece locks entirely above the
  visible playfield, or a block is pushed above the 20-row buffer.
* **SRS**: 5 kick tests per rotation attempt in a defined order; JLSTZ share one table, `I` has its
  own; `O` does not kick. Kick offsets are written as (x, y) with +y upward.
* **Scoring detail**: "Level is always considered to be the level before the line clear"; back-to-back
  applies to difficult clears (four-line clears, T-Spin line clears); a single/double/triple that
  is not a T-Spin breaks the chain; T-Spins with no lines do **not** break it; combo = 50 × combo
  count × level; perfect clear bonuses exist in later games and are added on top of the normal
  clear score.
* **T-Spin detection**: last successful action must be a rotation; three of the four corners
  diagonally adjacent to the T centre must be occupied; two occupied front corners (the corners
  next to the T's stem) = full T-Spin, otherwise Mini — except that Mini is promoted to a full
  T-Spin when the final rotation used the 1×2 / 2×1 SRS kick.
* **Gravity / speed curve** (S5): "based on `Tetris Worlds`" — the time for a piece to descend one
  row is documented as `(0.8 − 0.007 × (level − 1)) ^ (level − 1)` seconds, with a tabulated set of
  frame-accurate approximations. We independently re-derived the table from that formula and they
  agree (see `docs/RULESET.md` §5). TetrisWiki explicitly states there is **no concrete rule** for
  this curve past level 19, and that different shipping games diverge there.
* **Multiplayer attack table** (S7): single 0, double 1, triple 2, four-line clear 4, Mini T-Spin
  single 0, Mini T-Spin double 1, T-Spin single 2, T-Spin double 4, T-Spin triple 6; back-to-back
  bonuses +1 (Mini TSS / Mini TSD / TSS), +2 (TSD / four-line clear), +3 (TST); perfect clear 10
  (+ last line-clear type if applicable); several games add combo attack. Incoming garbage is
  queued and inserted at the bottom of the playfield on the next piece lock that does not clear
  lines; line clears first cancel queued incoming garbage, and the remainder is forwarded.

## 4. Explicit uncertainty and non-claims

* We do **not** claim any specific scoring table, gravity curve or lock-delay policy is
  "universally official". The publisher publishes a scoring table and a control scheme;
  everything else in §3 is community documentation of an internal specification that has been
  revised repeatedly and that shipping games deviate from.
* The Guideline's Marathon requirement is "clear lines, ten per level" in the fixed-goal form for
  many games; per-mode curves for Sprint/Ultra and for very high levels are not published.
* The publisher's portal does not document Sprint, Ultra or versus attack tables, so those
  portions of our ruleset are clearly marked as design decisions.
* **Anti-cheat**: no server-side authoritative simulation is implemented. The server validates,
  rate-limits and derives attacks from client-reported lock events. This is documented in
  `docs/PROTOCOL.md` as a known limitation — a hostile client can under-report or over-report its
  own clears. We make no claim of cheat resistance.
* **Browser verification limit**: this environment has no browser engine and cannot download one
  (the sandbox only reaches npm/PyPI/GitHub hosts). Service-worker install/activate behaviour and
  layout rendering were therefore verified by unit tests, by a build-integrity test over the real
  `dist/` output, and by a headless rasteriser that runs the *same* drawing code as the browser
  renderer (`tools/render-preview.ts`). The Playwright suite in `e2e/` covers keyboard, touch,
  resize, pause and offline behaviour but requires a local browser install; see `docs/FEATURES.md`
  for exactly what was and was not executed here.

## 5. Platform findings that shaped the implementation (S8, S9)

* Service workers require a secure origin (HTTPS or localhost/127.0.0.1). Consequently the offline
  test path serves the production build over HTTP on localhost so the worker is allowed to register.
* The lifecycle is versioned by cache name; a new worker stays in `waiting` until all clients of
  the old one are gone unless `skipWaiting()` is called, and it will not control already-open
  documents unless `clients.claim()` is called. STRATA uses an explicit "reload to update"
  prompt instead of silently swapping the worker mid-game.
* A page with an open WebSocket may be excluded from the bfcache, so the multiplayer client closes
  its socket when leaving the versus screen.
* `WebSocket` has no backpressure, so the client coalesces outbound state (its own board deltas) and
  the server bounds per-connection send frequency; the server also drops messages above a
  token-bucket rate limit rather than pausing the event loop.
