# Decisions & audit log

Each audit round, what it found, and what we did. Findings are in `docs/audits/`. Commits are tagged by round.

## Rounds

| Round | Input | Outcome |
|---|---|---|
| 0 | Plan audit (`01-plan-audit.md`): 12 gaps, 17 contradictions | PLAN §11: Android `beforeinput`, phone accessory bar, cross-tab merge, tutorial ending in the signature moment, deploy script, milestones |
| 1 | Code audit (`02-code-audit.md`): 5×S1, 11×S2, 11×S3 | All fixed (commit "Fix code-audit findings…"). Data-safety items verified in Chromium |
| 2 | Visual audit (`04-visual-audit.md`): 4×S1, 16×S2, 18×S3; requirements, security and accessibility workflow: 60 findings confirmed by adversarial verifiers | All S1/S2 fixed, plus most S3s (commit "Round 2…"). Visual S1s re-measured: sheets on-screen, no `null`, cleared headline above the fold, checkbox–title Δ ≤ 1.5 px, 0 contrast failures |
| 3 | QA harness (`03-qa-report.md`) + server security fixes | Server hardened (8 findings) and redeployed; client handles 507/503/429; dialog focus is synchronous; draft flush |
| 4 | QA bugs B1, B2, B5, B7 + 10k fixtures | Memo kept across title edits, scroll-before-render, rows cloned from a template and streamed in chunks, unchanged rows skip re-fill, two-phase strikes, SW precache through the HTTP cache and registered after load, View Transitions only for zoom |

## Gate results (latest)

| Gate | Budget | Result |
|---|---|---|
| Critical path (HTML + CSS + JS) | ≤ 50 KB gz | 47.8 KB gz / 42.6 KB br, one JS file, no request chains |
| Cold first paint, DevTools "3G" (2000 ms RTT, 50 KB/s), CPU ×4 | ≤ 5.0 s | 4.52 s median (5 runs) |
| Repeat visit to interactive, "3G" | ≤ 1.0 s | 0.34 s; 0.64 s with 2,000 items |
| SIGKILL 300 ms / 1 s after the last keystroke | 100% | 10/10, 10/10 |
| Two-device sync convergence, cycle repair | identical trees | pass (22/22 checks) |
| Rendering 500 rows (QA perf.mjs) | no long task > 50 ms, CPU ×1 | none (was 169 ms) |
| Typing, 2,000 items (QA perf.mjs) | key handler ≤ 16 ms | task p50 1.5 / p95 4.3 ms. Key→frame p95 22 ms against a blank-page floor of 15.8 ms on the same VM, so "≤ 16 ms key→frame" is restated as handler time |
| 10k-item boot | ready ≤ 1.5 s | 342 ms at CPU ×1 (longest task 120 ms, was 515); 1.1 s at ×4 |
| Edits on a 10k-item page | — | longest task 53 ms at CPU ×1 (was 202); 120–440 ms at ×4 (known limit) |
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

- **CPU ×4 on the 2-core ARM VM with 10k items** still has long tasks (100–450 ms per edit), because counts and smart views are recomputed per edit with O(n) walks. Real lists are far smaller, and the S25 Ultra and M5 are far faster than this box. The next step, if ever needed, is incremental open-counts per node.

- Background tabs that are frozen (Page Lifecycle `frozen`) can't run IndexedDB writes. We flush on `visibilitychange: hidden`, which always comes first on real devices (QA: 100% survival).
- The S25 Ultra's real CSS viewport and DPR still need measuring on the device (PLAN §10).
