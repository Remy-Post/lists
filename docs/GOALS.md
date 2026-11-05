# Lists — Goals & Constraints

The north star every team checks its work against. If a decision doesn't serve a line here, it doesn't ship.

## Mission
A to-do app at **lists.remypost.me** that feels as calm and inevitable as the best tools ever made,
and that stays fast on a bad 3G connection.

## Hard requirements (from Remy)
1. **n lists, n levels.** Unlimited lists; any item can hold sub-items, to any depth.
2. **Local-first.** Data lives on the device and works offline. Closing the tab, killing the browser, or rebooting the phone loses nothing.
3. **Opportunistic backend sync.** Sync only when the connection is good (Wi-Fi or fast) *and* the backend copy is stale past a threshold (or on demand). Otherwise stay local.
4. **Low-bandwidth.** Tested under Chrome DevTools "3G" throttling. The first paint must not wait on heavy assets.
5. **Separate HTML / CSS / JS** (a build stack is allowed if it pays for itself; lighter is better, since many sites share this VM).
6. **Two tuned viewports:** Samsung Galaxy S25 Ultra (Android Chrome) and 16" MacBook Pro M5.
7. **Premium, high-fidelity feel:** micro-interactions, motion, tasteful WebGL/3D where it earns its place. No "AI slop".
8. **Keyboard-first**, **smart views** (Today / Upcoming), **themes & polish**.
9. **Public GitHub repo** (Remy-Post), documented in markdown.
10. **Tested for real:** in a real browser, on throttled networks, and on the phone where possible.

## Process
Plan → audit the plan → build → audit code → audit visuals → audit interactivity → iterate. Teams are separate, each with one clear owner and deliverable (see `TEAMS.md`).

## Budgets (initial, refined in PLAN.md)
- Critical path (HTML + CSS + JS needed for first interactive paint): **≤ 50 KB gzip**.
- Usable offline after the first visit (service worker).
- Enhancement assets (WebGL, fonts beyond the first) load lazily after interaction, and never on Save-Data.
- Host cost: static files behind Caddy, plus one tiny sync service (≤ 30 MB RAM).
