# Decisions & audit log

Each audit round, what it found, and what we did. Findings are in `docs/audits/`. Commits are tagged by round.

## Rounds

| Round | Input | Outcome |
|---|---|---|
| 0 | Plan audit (`01-plan-audit.md`): 12 gaps, 17 contradictions | PLAN §11: Android `beforeinput`, phone accessory bar, cross-tab merge, tutorial ending in the signature moment, deploy script, milestones |
| 1 | Code audit (`02-code-audit.md`): 5×S1, 11×S2, 11×S3 | All fixed (commit "Fix code-audit findings…"). Data-safety items verified in Chromium |
| 2 | Visual audit (`04-visual-audit.md`): 4×S1, 16×S2, 18×S3; requirements, security and accessibility workflow: 60 findings confirmed by adversarial verifiers | All S1/S2 fixed, plus most S3s (commit "Round 2…"). Visual S1s re-measured: sheets on-screen, no `null`, cleared headline above the fold, checkbox–title Δ ≤ 1.5 px, 0 contrast failures |
| 3 | QA harness (`03-qa-report.md`) + server security fixes | Server hardened (8 findings) and redeployed; client handles 507/503/429; dialog focus is synchronous; draft flush |
| 9 | Clean QA run | Typing gate aligned with its documented definition (handler time); weak hardware (≤ 2 cores or ≤ 2 GB) skips the FLIP pre-measure and the condense animation; outline pages reuse the row model for non-structural edits (completions now 18–33 ms at ×4) |
| 8 | Slow-CPU follow-up + real-Mac findings | Single-item edits skip the order walk; the Today badge updates in idle time; completed and dated items are tracked incrementally; small sets sort by path instead of a full order walk; panel styles and pairing dialog load lazily (critical path 49.3 KB). Real Mac: an already-clear Today now opens cleared; Settings no longer shows a stray "null" |
| 7 | Remaining slow-CPU gates | Completion, heading and move edits patch the cached tree (property-tested against brute force: 3 seeds × 600 random edits including moves); pages build in 12-row slices per frame; IndexedDB loads in 2,000-record pages; Markdown import/export moved to the lazy chunk; real-Mac typing measured |
| 5 | Final fresh-eyes regression review (19 confirmed findings, each verified by a skeptic) + 10k profiling | All 19 fixed and re-verified by `tests/e2e/review-fixes.mjs` (9/9). Row signatures use local revisions; on-demand rows; one Tab stop; quick-add order and click-to-literal; keys work after mouse navigation; lazy sync loads in already-open tabs and retries after a failed chunk; zoom origin measured before scroll; only real zooms animate; drawer closes with a mouse; shared sync settings mirror across tabs; one allocation-free tree walk per change (Today query 3–20 ms → ~1 ms on 10k) |
| 6 | Row virtualization + first real-device test (Remy's Mac: M5 Pro, 1728×1117 @2x, P3/HDR) + independent review (3 confirmed: focus lost when the window slides, blank list for off-window anchors, drag line lost on autoscroll) | Pages over 300 items render only rows near the viewport. Review findings fixed and covered by `review-fixes.mjs` (15/15). The Mac test found completed items jumping to the bottom of Today; they now stay in place in every smart view. Settings shows the device's viewport, DPR and connection, so the S25 can be measured without remote debugging |
| 4 | QA bugs B1, B2, B5, B7 + 10k fixtures | Memo kept across title edits, scroll-before-render, rows cloned from a template and streamed in chunks, unchanged rows skip re-fill, two-phase strikes, SW precache through the HTTP cache and registered after load, View Transitions only for zoom |

## Gate results (latest)

| Gate | Budget | Result |
|---|---|---|
| Critical path (HTML + CSS + JS) | ≤ 50 KB gz | 47.8 KB gz / 42.6 KB br, one JS file, no request chains |
| Cold first paint, DevTools "3G" (2000 ms RTT, 50 KB/s), CPU ×4 | ≤ 5.0 s | 4.57 s median; interactive at 5.2 s (was 7.2 s); 137 KB on the wire (was 198 KB); no reload, no request chains |
| Repeat visit to interactive, "3G" | ≤ 1.0 s | 0.31 s; 0.49 s with 2,000 items (all from the service worker) |
| Sync gate under 3G | waits | 'Waiting for a good connection', 0 requests; syncs when the link is good and the backup stale |
| SIGKILL 300 ms / 1 s after the last keystroke | 100% | 10/10, 10/10 |
| Two-device sync convergence, cycle repair | identical trees | pass (22/22 checks) |
| Rendering 500 rows (QA perf.mjs) | no long task > 50 ms, CPU ×1 | none (was 169 ms); only ~51 rows in the DOM (virtualized) |
| **Typing on the real MacBook Pro M5** (Chrome 156, 120 Hz ProMotion, frame 8.4 ms; 51 real keystrokes) | keypress → painted frame ≤ 16 ms | **p50 9.1 · p95 12.6 · max 13.3 ms: pass** |
| Typing, 2,000 items (QA perf.mjs) | key handler ≤ 16 ms | task p50 1.5 / p95 4.3 ms. Key→frame p95 22 ms against a blank-page floor of 15.8 ms on the same VM, so "≤ 16 ms key→frame" is restated as handler time |
| 10k-item boot (QA perf.mjs, CPU ×4) | ready ≤ 1.5 s; one task ≤ 200 ms | ready 0.92 s; longest task 141 ms (was 495): **pass** |
| **QA perf.mjs official run (latest)** | all gates | **9 of 10 pass.** Keystroke handler p95 3.2 ms (2k) / 3.2 ms (10k); 500-row page with no long task at ×1 and ×4; 10k boot 0.88 s, longest task 153 ms; heap 32 MB. The one miss: the ×4 interaction script's longest task is 72 ms (4 of 21 steps over 50 ms, all indents or the Today switch) |
| QA interaction script on 10k items (complete ×10, indent ×9, navigate away and back) | no long task > 50 ms | CPU ×1: **none**. CPU ×4: an exact replica of the script records **none** (2 runs); QA's own run records 53–84 ms during indents (was 404). The work sits at the threshold, so VM noise decides |
| Opening a 500-row page, CPU ×4 | no long task > 50 ms | 59 ms in QA's run (was 258); 0 ms in the 650-row probe (was 873) |
| Stray "null"/"undefined" text in any surface | none | none (regression check over Settings, inspector, palette, quick add, date picker, shortcuts) |
| Flows / two-device sync / unit | all | 44/44 · 22/22 · 44/44 |
| Contrast | all text ≥ 4.5:1 | 0 failures, both themes, both devices |
| Server memory | ≤ 30 MB | 14.7 MiB |

## Deliberate deviations from PLAN

- **`e` = This evening, not complete.** Mirrors Things' ⌘E; `x` and ⌘↵ complete. The cheat sheet (`?`) is the source of truth.
- **"tom" is not a quick-add date.** "Call Tom" must stay literal. `tomorrow`, `tmr` and `tmrw` work; `tom` still works in the date picker.
- **Tab indents in navigation mode too** (outliner convention, and it works on a multi-selection). It passes focus on when an indent isn't possible, so there is no keyboard trap. ⌥⇧→/← are alternatives.
- **Completed items stay in place, struck, until the next day** ("daily logging"); there is no collapse into a Done group. Show/hide older ones with ⌘⇧H.
- **Separate viewport stylesheets** (`phone.css`, `desk.css`) stay, because Remy asked for them. They're fetched in parallel and never block render.
- **Sync cadence.** Remy's wording was "if the backend hasn't been updated in X days and Wi-Fi is good, update it; otherwise stay local." Implemented as two settings:
  - **Sync on Wi-Fi:** As you go (default) / Daily / Every 3 days / Weekly. Choosing Daily or longer gives exactly Remy's rule.
  - **On mobile data after:** 1 / 3 (default) / 7 days. If the server copy is older than this and there are unsent changes, sync on any connection except 2G or Data Saver.
- **Pairing links ask before joining** (security review). They show the code's first and last groups to compare against the other device.

## Known limits

- **10k items at CPU ×4 on the 2-core ARM VM** (roughly a budget phone). QA's harness still records sporadic 50–85 ms tasks, with readings varying from run to run (97, 131, 84, 85 ms). Exact replicas of its script record none on most runs: with cursor, service worker, back-to-back timing and DPR 2, five runs recorded none and one recorded 51–68 ms. A traced run recorded none. The VM's load average was 2.26 on 2 cores during these runs, shared with n8n, MongoDB and the other sites, so contention decides the threshold. On ≤ 2-core or ≤ 2 GB devices the app now snaps the type-condense effect (the strike still draws) and builds pages in 6-row slices. Everything at CPU ×1 passes with no long tasks, and the real M5 Pro types at 9–13 ms per keystroke.
- **Typing key→frame p95 ≤ 16 ms is unreachable on this VM** (a blank page scores 16.6 ms p95), so the gate is the handler time: p95 4.5–5.9 ms.

- Background tabs that are frozen (Page Lifecycle `frozen`) can't run IndexedDB writes. We flush on `visibilitychange: hidden`, which always comes first on real devices (QA: 100% survival).
- **S25 Ultra not yet measured.** Claude in Chrome can't open chrome://inspect. Open Settings on the phone: its last line shows viewport, screen, DPR and connection.
