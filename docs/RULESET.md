# STRATA — Ruleset "STRATA Standard v1"

This document is normative for the engine in `src/engine/`. Every rule below is either

* **[OFFICIAL]** — published by the rights holder on `play.tetris.com` (see `docs/RESEARCH.md` S1),
* **[COMMUNITY]** — community-documented convention from TetrisWiki (S2–S7), not a publisher
  statement, or
* **[DECISION]** — our own choice where the sources are silent or contradictory, chosen once and
  applied consistently everywhere.

Nothing here is a claim that a given curve or table is "universally official". Sources disagree
between shipping games; where they do, we pick one and say so.

---

## 1. Playfield and geometry

| Item | Value | Source |
| --- | --- | --- |
| Visible playfield | 10 columns × 20 rows | OFFICIAL (matrix is 10×20) / COMMUNITY |
| Hidden buffer | 20 rows above the visible field (internal grid is 10 × 40) | COMMUNITY |
| Coordinate system | `(x, y)`, `x` 0 (left) → 9 (right); `y` 0 (top of buffer) → 39 (bottom visible row). Visible rows are `y ≥ 20`. | DECISION |
| Spawn columns | `I`, `O`, and the 3-wide pieces spawn centred; `J`, `L`, `S`, `T`, `Z` spawn rounded left. All spawn flat side down, horizontal. | COMMUNITY |
| Spawn rows | `J,L,S,T,Z,O` occupy hidden rows 18–19; `I` occupies hidden row 19 (the lower of the two, as in the Guideline). The buffer itself is not rendered, but its last row is drawn as a sliver so spawning pieces are visible. | COMMUNITY arrangement, DECISION offset |

Concretely, the spawn bounding boxes are (0-indexed `x`, `y` of the box's top-left corner):

| Piece | Box | Spawn box origin | Occupied cells (box-local) |
| --- | --- | --- | --- |
| I | 4×4 | (3, 18) | (0,1) (1,1) (2,1) (3,1) |
| J | 3×3 | (3, 18) | (0,0) (0,1) (1,1) (2,1) |
| L | 3×3 | (3, 18) | (2,0) (0,1) (1,1) (2,1) |
| O | 2×2 | (4, 18) | (0,0) (1,0) (0,1) (1,1) |
| S | 3×3 | (3, 18) | (1,0) (2,0) (0,1) (1,1) |
| T | 3×3 | (3, 18) | (1,0) (0,1) (1,1) (2,1) |
| Z | 3×3 | (3, 18) | (0,0) (1,0) (1,1) (2,1) |

Every piece's lowest mino is in hidden row 19; `J,L,S,T,Z,O` also use row 18 and `I` uses row 19
only, which is the Guideline's relative arrangement.

## 2. Rotation (SRS) [COMMUNITY]

Four rotation states per piece: `0` (spawn), `R` (one clockwise), `2`, `L` (one counter-clockwise).
`I` and `O` rotate about a grid intersection; the rest rotate about the centre of a mino.

Wall-kick test order for **J, L, S, T, Z** — offsets `(dx, dy)` with `+y` = up:

| Test | 0→R | R→0 | R→2 | 2→R | 2→L | L→2 | L→0 | 0→L |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | (0,0) | (0,0) | (0,0) | (0,0) | (0,0) | (0,0) | (0,0) | (0,0) |
| 2 | (−1,0) | (+1,0) | (+1,0) | (−1,0) | (+1,0) | (−1,0) | (−1,0) | (+1,0) |
| 3 | (−1,+1) | (+1,−1) | (+1,−1) | (−1,+1) | (+1,+1) | (−1,−1) | (−1,−1) | (+1,+1) |
| 4 | (0,−2) | (0,+2) | (0,+2) | (0,−2) | (0,−2) | (0,+2) | (0,+2) | (0,−2) |
| 5 | (−1,−2) | (+1,+2) | (+1,+2) | (−1,−2) | (+1,−2) | (−1,+2) | (−1,+2) | (+1,−2) |

Wall-kick test order for **I**:

| Test | 0→R | R→0 | R→2 | 2→R | 2→L | L→2 | L→0 | 0→L |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | (0,0) | (0,0) | (0,0) | (0,0) | (0,0) | (0,0) | (0,0) | (0,0) |
| 2 | (−2,0) | (+2,0) | (−1,0) | (+1,0) | (+2,0) | (−2,0) | (+1,0) | (−1,0) |
| 3 | (+1,0) | (−1,0) | (+2,0) | (−2,0) | (−1,0) | (+1,0) | (−2,0) | (+2,0) |
| 4 | (−2,−1) | (+2,+1) | (−1,+2) | (+1,−2) | (+2,+1) | (−2,−1) | (+1,−2) | (−1,+2) |
| 5 | (+1,+2) | (−1,−2) | (+2,−1) | (−2,+1) | (−1,−2) | (+1,+2) | (−2,+1) | (+2,−1) |

**O** does not kick; rotations are a visual no-op.
Rotations are attempted in the order above and stop at the first non-colliding position (the first
test is the plain rotation). If all five fail, the piece keeps its previous state and position and
the attempt reports failure (a failed attempt does not count as a move for lock-delay resets, does
not cancel a T-spin, and plays the "blocked" cue instead of the rotate cue).

## 3. Randomizer [COMMUNITY]

Seven-bag: shuffle a bag of `I J L O S T Z` with Fisher–Yates and deal it in order; refill when
empty. The queue always holds at least 6 pieces (hold + 5 previews are drawn from it, and 5
previews are always visible). Shuffling uses the engine's seeded PRNG (§10), so a given seed
always yields the same sequence.

## 4. Hold [COMMUNITY]

* One hold slot. `C` / `Shift` stores the active piece, or swaps it with the stored one.
* A swap spawns the incoming piece at the spawn position and orientation.
* Hold is unavailable until the next lock after a successful hold ("once per active piece").
* Hold re-triggers the spawn state; it does not reset the T-spin flag of a *new* piece (a new piece
  has no T-spin flag), and it clears the lock-delay reset counter (fresh piece).
* Holding an empty slot does not consume the hold allowance in the sense that the stored piece
  becomes active... it does consume it: the piece that was active is now stored and cannot be
  retrieved until the next piece locks. This matches "Hold cannot be used again until the piece
  locks down".

## 5. Gravity, levels and speed [COMMUNITY curve, DECISION cap]

Time for the active piece to descend one row, by level:

```
secondsPerRow(level) = (0.8 − 0.007 × (level − 1)) ^ (level − 1)
```

This reproduces the tabulated `Tetris Worlds`-derived values (verified numerically, see below).
`1G` means one row per frame at 60 Hz; `20G` means the piece crosses a 20-row field in one frame.

| Level | s/row | G | cells/s | | Level | s/row | G | cells/s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.000000 | 0.0167 | 1.0 | | 11 | 0.042976 | 0.3878 | 23.3 |
| 2 | 0.793000 | 0.0210 | 1.3 | | 12 | 0.028218 | 0.5907 | 35.4 |
| 3 | 0.617796 | 0.0270 | 1.6 | | 13 | 0.018153 | 0.9181 | 55.1 |
| 4 | 0.472729 | 0.0353 | 2.1 | | 14 | 0.011439 | 1.4570 | 87.4 |
| 5 | 0.355197 | 0.0469 | 2.8 | | 15 | 0.007059 | 2.3612 | 141.7 |
| 6 | 0.262004 | 0.0636 | 3.8 | | 16 | 0.004264 | 3.9091 | 234.5 |
| 7 | 0.189677 | 0.0879 | 5.3 | | 17 | 0.002520 | 6.6135 | 396.8 |
| 8 | 0.134735 | 0.1237 | 7.4 | | 18 | 0.001457 | 11.4379 | 686.3 |
| 9 | 0.093882 | 0.1775 | 10.7 | | 19 | 0.000824 | 20.2288 | 1213.7 |
| 10 | 0.064152 | 0.2598 | 15.6 | | 20 | 0.000455 | 36.5981 | 2195.9 |

Rounding differences against the published approximate table are ≥ 4 decimal places.

**Level progression:** fixed-goal — ten cleared lines per level, configurable
(`linesPerLevel`, default 10). Levels increase only by clearing lines, never by time.
Excess lines carry over (a double that crosses a boundary banks the remainder in the next level).

**Speed cap (setting `speedCapLevel`, default 15):** the gravity curve is evaluated at
`min(level, speedCapLevel)`, i.e. gravity stops increasing at the cap while the level counter keeps
rising. This matches the widely implemented "gravity stops increasing past the level cap in endless
play" behaviour. Options: 15 (default), 20, or "no cap"; with no cap, gravity is clamped to 20G
(one full-field drop per frame) from level 19 onward and the lock delay shrinks per §6 to keep the
game playable. TetrisWiki explicitly states there is no agreed rule past level 19 — this is a
DECISION, and it is listed in the settings UI as such.

## 6. Lock delay and reset policy [COMMUNITY base, DECISION details]

* Base lock delay `0.5 s` (Guideline value; applies while gravity < 20G).
* **Reset policy: move reset (extended placement) with a hard limit of 15 resets per piece.**
  * A *reset* is granted when a successful horizontal movement or rotation occurs while the piece
    is grounded (resting on the floor or stack).
  * Failed moves and rotations do not reset the timer.
  * Downward movement caused by gravity or soft drop does not reset the timer (that is "step
    reset", which we deliberately do not implement).
  * After the 15th reset, further grounded moves no longer extend the timer; the piece locks
    500 ms after the last reset.
  * When the piece is airborne the timer is held at zero, and the reset counter is kept.
* At 20G or above (only reachable with `speedCapLevel` 20 or "no cap", or a maxed soft drop),
  the delay is `max(0.2 s, 0.5 s − 0.03 s × (level − 20))`.

## 7. Drops

| Action | Effect | Scoring | Source |
| --- | --- | --- | --- |
| Gravity | automatic downward step per §5 | — | — |
| Soft drop (↓) | falls at `max(20 × gravity(level), 10 cells/s)`, clamped to 20G; does **not** lock on contact | 1 point per cell descended by soft drop | OFFICIAL (rate is DECISION) |
| Hard drop (Space) | teleports to the landing row and locks immediately | 2 points per cell descended | OFFICIAL |

Soft drop is non-locking: landing while soft drop is held behaves like normal gravity contact and
starts the lock delay. Soft-drop points are awarded per cell actually moved, so holding ↓ against
the floor awards nothing.

## 8. Line clears, scoring and combos

Cleared rows are removed and rows above compact downward; multiple rows clear simultaneously.

**Base scores [OFFICIAL table, per `play.tetris.com/games/`]**, always multiplied by the level
*in effect before the clear* [COMMUNITY]:

| Action | Points | Difficult (B2B)? |
| --- | --- | --- |
| Single | 100 × level | no |
| Double | 300 × level | no |
| Triple | 500 × level | no |
| Four-line clear | 800 × level | yes |
| Mini T-Spin, no lines | 100 × level | no |
| T-Spin, no lines | 400 × level | no |
| Mini T-Spin Single | 200 × level | yes |
| T-Spin Single | 800 × level | yes |
| Mini T-Spin Double | 400 × level | yes |
| T-Spin Double | 1200 × level | yes |
| T-Spin Triple | 1600 × level | yes |
| Soft drop | 1 per cell | — |
| Hard drop | 2 per cell | — |

**Back-to-back [OFFICIAL: "0.5 × Tetris or T-Spin" / COMMUNITY: ×1.5]**
A difficult clear extends the chain and earns `base + floor(base / 2)`. A single, double or triple
that is not a T-Spin line clear **breaks** the chain; a T-Spin or Mini T-Spin with **no** lines does
not break it. The first difficult clear after a break earns no bonus.

**Combo [COMMUNITY]** — every lock that clears at least one line increments the combo counter;
a lock that clears nothing resets it. With `combo` = number of consecutive line-clearing locks
counting this one, the bonus is `50 × (combo − 1) × level` (so the first clear earns no bonus, the
second earns `50 × level`, and so on).

**Perfect clear** (setting `perfectClearBonus`, default on) [COMMUNITY]: when the board is emptied,
add `800 / 1200 / 1800 / 2000 × level` for a 1/2/3/4-line perfect clear, or `3200 × level` for a
back-to-back four-line perfect clear. These are added on top of the normal clear score.

**Order of operations per lock** (tested): soft/hard drop points → line clear base → back-to-back
multiplier → combo bonus → perfect-clear bonus → update combo/B2B state → level/line counters →
record stats. Level is captured *before* the clear for every multiplication.

## 9. T-Spin detection [COMMUNITY 3-corner rule]

On lock, a piece earns a T-Spin only if **all** hold:

1. the piece is a `T`,
2. its last successful action was a **rotation** (a hard drop immediately after the rotation keeps
   the flag; a *successful* soft-drop step or horizontal move clears it; a blocked move does not),
3. at least three of the four cells diagonally adjacent to the T's rotation centre are occupied
   (by the stack, the walls, or the floor).

Then:

* if both **front** corners (the two corners adjacent to the T's stem) are occupied → full T-Spin;
* otherwise → **Mini T-Spin**, *unless* the last rotation used a kick of `(±1, ±2)` or `(±2, ±1)`,
  in which case it is promoted to a full T-Spin.

Line clears and no-line "spins" both score per §8.

## 10. Determinism [DECISION]

A 32-bit xorshift generator (Marsaglia's 13/17/5 triple, `src/engine/rng.ts`) whose state is
derived from a 32-bit seed by a splitmix-style mixer; the zero state is excluded. Every random
decision in the engine — the 7-bag shuffle and garbage hole columns — draws from this single
stream, so a game is fully reproducible from its seed. The seed is exposed in the game summary
(and in saved records) so any single-player game can be replayed. Versus matches use a
server-issued shared seed so both players receive identical piece sequences; the server never
trusts a client-reported seed for anything that affects the match outcome.

## 11. Top-out / game over [COMMUNITY]

The game ends when either occurs:

* a spawning piece overlaps existing blocks (block-out), or
* a piece locks with all of its minoes strictly above the visible playfield (lock-out).

Both are detected at the same point in the lock sequence, and both produce a game-over event with
the final board, score, lines and duration.

## 12. Modes

| Mode | Goal | Level progression | Gravity | End condition | Primary record |
| --- | --- | --- | --- | --- | --- |
| Marathon | endless | 10 lines/level, `speedCapLevel` 15 | §5 curve | top-out | score (with lines + level + time) |
| Sprint | clear 40 lines | none (fixed level 1) | level 1 (1 cell/s) | 40 lines cleared → win; top-out → loss | fastest time |
| Ultra | maximise score in 2:00 | none (fixed level 1) | level 1 (1 cell/s) | timer reaches 0; top-out → loss | score in 120 s |
| Versus | beat the other player | none (fixed level 1) | level 1 | opponent top-out → win; own top-out → loss | W/L record, best attack |

Sprint/Ultra level lock and versus fixed gravity are DECISIONS (the publisher does not document
per-mode curves); they keep the modes comparable between runs.

## 13. Multiplayer attack [COMMUNITY table + DECISION for combo]

Attack is computed from a validated lock event (`clearType`, lines, back-to-back flag, combo
count, perfect-clear flag) by the server, not the client.

| Clear | Garbage sent |
| --- | --- |
| Single, Mini T-Spin Single | 0 |
| Double, Mini T-Spin Double | 1 |
| Triple | 2 |
| Four-line clear | 4 |
| T-Spin Single | 2 |
| T-Spin Double | 4 |
| T-Spin Triple | 6 |
| T-Spin / Mini T-Spin with no lines | 0 |
| Back-to-back bonus | +1 (Mini TSS, Mini TSD, TSS) · +2 (TSD, four-line clear) · +3 (TST) |
| Combo bonus **DECISION** | `min(combo − 1, 4)` extra lines, i.e. +1 on the 2nd consecutive clear, capped at +4 |
| Perfect clear | +10 |

**Cancellation and insertion:**
* Incoming garbage waits in a queue displayed next to the board.
* Outgoing attack cancels pending incoming garbage **1:1**; whatever is left over is sent.
* Pending garbage that survives is inserted at the bottom of the playfield **on the next lock that
  clears no lines** (clearing lines delays it), together with the attack computed at that same lock.
* A single insertion is capped at 8 rows; leftover rows stay queued.
* Each insertion is one "burst": all rows share a single hole column, chosen by a server-side PRNG;
  consecutive bursts never use the same column twice in a row.
* Garbage rows are never queued for insertion while the player's board is empty and it is the first
  burst of the match *if* the player has not yet cleared any lines — DECISION: to prevent a
  degenerate opening, garbage is not delivered until each player has completed at least one lock.

## 14. Input handling defaults [OFFICIAL mapping, COMMUNITY timings]

| Key | Action |
| --- | --- |
| ← / → | move left / right (DAS then ARR auto-repeat) |
| ↓ | soft drop |
| ↑ / X | rotate clockwise |
| Z / Ctrl | rotate counter-clockwise |
| C / Shift | hold |
| Space | hard drop |
| Esc / P | pause (single-player modes) |
| R | restart (with confirmation during play) |
| M | mute |

* DAS `167 ms`, ARR `33 ms` (the guideline-recommended values) — configurable presets
  *Guideline (167/33)*, *Fast (133/17)*, *Instant (117/0)*, *Custom*.
* Auto-repeat only applies while the key is held; a fresh press always moves immediately.
* Opposite-direction presses follow "last input wins" (DECISION).
* All bindings are rebindable and persisted (§ storage).
* Gameplay keys are captured on the game container, `preventDefault`ed there, and **not**
  prevented when focus is in a form field or when the settings dialog is open.

## 15. Accessibility and presentation commitments

Reduced-motion support disables line-clear flashes, drop streaks and menu transitions; sound is
synthesised locally and independently toggleable for effects and music; every mode, setting and
dialog is reachable and operable with the keyboard alone, has a visible focus ring and an
appropriate ARIA role; the HUD exposes score/lines/level/time/next-piece as live regions at a
polite rate (at most once per second for score); and a colour-vision option replaces colour-only
encoding with per-piece glyph marks inside the cells.
