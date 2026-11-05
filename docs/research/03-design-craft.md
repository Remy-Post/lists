# 03 — Design Craft: interaction feel, identity, type, color, motion and WebGL for Lists

*Research date: 2026-11-05. Scope: the premium to-do web app "Lists" (lists.remypost.me), vanilla HTML/CSS/JS, which has to stay fast on 3G.*

Every factual claim below links to its source. Where we add our own judgment it is marked **Recommendation** or *(our call)*. We measured byte sizes ourselves on the research date (method in §3.1 and §5.1); they are not copied from marketing pages.

---

## TL;DR

- **Feel comes from speed and restraint, not from the amount of motion.** Keep UI animations under 300 ms ([Kowalski](https://emilkowal.ski/ui/you-dont-need-animations)). Don't animate keyboard-driven or high-frequency actions ([Kowalski](https://emilkowal.ski/ui/you-dont-need-animations), [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/motion)). Make every animation interruptible ([Freiberg](https://rauno.me/craft/interaction-design), [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/motion)). Apply changes optimistically and offer Undo ([Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines)).
- **Use the platform before libraries.** CSS transitions (interruptible), `@starting-style`, View Transitions, `linear()` springs and WAAPI now cover about 95% of what a to-do app needs, at 0 KB. Motion's `animate` (mini, 3.2 kB) is the only library worth keeping in reserve.
- **AI-slop tells are now well catalogued**, by [Anthropic's own frontend-design skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md), [Impeccable](https://impeccable.style/slop), [Jim Nielsen](https://blog.jim-nielsen.com/2026/ai-aesthetic/), [Adrian Krebs' 1,590-site scan](https://www.adriankrebs.ch/blog/design-slop/) and [HN](https://news.ycombinator.com/item?id=45622944). The cure is the same everywhere: choices drawn from the subject's own world, one memorable element, and quiet everywhere else.
- **Type:** Mona Sans (variable width and weight, OFL) is our pick. It costs 39.8 KB with the weight axis only, or 98 KB with the width axis too. Behind it sits a metric-matched `system-ui` fallback, and Save-Data skips the webfont entirely.
- **Color:** a 3-input OKLCH theme in the spirit of [Linear's](https://linear.app/now/how-we-redesigned-the-linear-ui) (base, accent, contrast), with P3 chroma boosts behind `@media (color-gamut: p3)` ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)).
- **WebGL:** raw WebGL2 with one fullscreen triangle costs about 1.1 KB gzipped. OGL's minimal set is about 14 KB, and three.js is 148–190 KB even tree-shaken. Use raw WebGL2, lazy-loaded, for exactly one moment.
- **Direction: "Blue Pencil".** Cool graphite neutrals, the editor's blue pencil as the accent, the width axis as the hierarchy device, and a hand-drawn strike as the motion signature. The one memorable moment is a raking-light shader over the day's strikes when Today is cleared.

---

## 1. Principles of premium interaction feel

### 1.1 Timing budget

| Interaction | Duration | Easing | Source |
|---|---|---|---|
| Direct-manipulation feedback (press, drag follow) | **0 ms delay**; apply the gesture delta immediately | none (track the input) | Freiberg: "respond immediately… apply the gesture's delta right away rather than playing a fixed animation" ([Invisible Details](https://rauno.me/craft/interaction-design)) |
| Perceived-instant threshold | **≤100 ms** | — | Nielsen: 0.1 s feels like direct control ([NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)) |
| Tooltips, small popovers | **125 ms** | `ease-out`, from `scale(0.97)` + opacity 0 | [Kowalski, 7 practical tips](https://emilkowal.ski/ui/7-practical-animation-tips) |
| Dropdown or select | **180 ms** feels more responsive than 400 ms | `ease-out` | [Kowalski](https://emilkowal.ski/ui/you-dont-need-animations) |
| General UI ceiling | **< 300 ms** | — | [Kowalski, great animations](https://emilkowal.ski/ui/great-animations); Stripe used "under 500 milliseconds" in 2017 ([De Cock](https://stripe.com/blog/connect-front-end-experience)) |
| Material duration scale | short 50/100/150/200, medium 250/300/350/400, long 450–600, extra-long 700–1000 ms | see §1.2 | [Material Web tokens](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-motion.scss) |
| Drop-target highlight | **350 ms** | `cubic-bezier(0.15, 1, 0.3, 1)` | [Atlassian Pragmatic DnD guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines) |
| Post-drop "this moved" flash | **700 ms** | `cubic-bezier(0.25, 0.1, 0.25, 1)` | [Atlassian](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines) |
| Spinner or skeleton | show only after **150–300 ms**, then keep it visible for at least **300–500 ms** | — | [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines) |
| Mutations (POST/PATCH/DELETE) | complete in **< 500 ms** | — | [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines) |
| Keyboard navigation (j/k, arrows) | **0 ms**; no animation | — | Kowalski: "Keyboard actions: never animate" ([source](https://emilkowal.ski/ui/you-dont-need-animations)) |
| Placeholder-to-canvas crossfade | **600 ms** (WAAPI) | — | GitHub globe ([Ahlin](https://github.blog/engineering/user-experience/how-we-built-the-github-globe/)) |

**Frequency rule.** The more often something happens, the less it should move. Kowalski points to Raycast, which is opened hundreds of times a day and has no open animation ([source](https://emilkowal.ski/ui/you-dont-need-animations)). Apple says "generally avoid adding motion to UI interactions that occur frequently" ([HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)). Cultured Code's CEO Werner Jainek gives the same test: "If you quickly get tired of it, it's unnecessary" ([sspai interview](https://www.sspai.com/post/39724), translated).

### 1.2 Easing curves and springs, with numbers

**Curves (CSS `cubic-bezier`)**

| Name | Value | Use | Source |
|---|---|---|---|
| Material *standard* | `cubic-bezier(0.2, 0, 0, 1)` | default state changes | [Material Web tokens](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-motion.scss) |
| Material *emphasized-decelerate* | `cubic-bezier(0.05, 0.7, 0.1, 1)` | elements entering | same |
| Material *emphasized-accelerate* | `cubic-bezier(0.3, 0, 0.8, 0.15)` | elements leaving for good | same |
| Material *standard-decelerate* | `cubic-bezier(0, 0, 0, 1)` | small entering elements | same |
| Vaul drawer (iOS-sheet feel) | `cubic-bezier(0.32, 0.72, 0, 1)`, 500 ms | sheets and drawers | [Vaul source, Kowalski](https://raw.githubusercontent.com/emilkowalski/vaul/main/src/constants.ts) |
| Atlassian drop highlight | `cubic-bezier(0.15, 1, 0.3, 1)` | hover-on-target | [Atlassian](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines) |

Rules of thumb:
- Use ease-out for anything entering or leaving, and avoid `ease-in` for UI because it "felt slower" ([Kowalski](https://emilkowal.ski/ui/7-practical-animation-tips)).
- The built-in CSS curves are "too weak", so prefer custom ones ([Kowalski](https://emilkowal.ski/ui/7-practical-animation-tips)). Stripe also avoided `ease-in`/`linear` in favour of custom `cubic-bezier` ([De Cock](https://stripe.com/blog/connect-front-end-experience)).
- Impeccable lists "bouncy or elastic easing on routine dialogs" as a tell; such dialogs should "settle quickly" ([Impeccable](https://impeccable.style/slop)).

**Springs (stiffness *k*, damping ratio ζ, mass 1).** These are Google's shipping values, read straight from AOSP Compose source:

| Token | Spatial (position/size) | Effects (opacity/color) | Source |
|---|---|---|---|
| Standard fast / default / slow | k 1400 / 700 / 300, ζ 0.9 | k 3800 / 1600 / 800, ζ 1.0 | [StandardMotionTokens.kt](https://android.googlesource.com/platform/frameworks/support/+/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/StandardMotionTokens.kt) |
| Expressive fast / default / slow | k 800 / 380 / 200, ζ 0.6 / 0.8 / 0.8 | k 3800 / 1600 / 800, ζ 1.0 | [ExpressiveMotionTokens.kt](https://android.googlesource.com/platform/frameworks/support/+/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ExpressiveMotionTokens.kt) |

The pattern to copy is that **spatial motion may overshoot, but colour and opacity never do** (ζ = 1). Comeau makes the same point: most good spring use "is not bouncy", and springs suit motion, not colour or opacity ([Josh Comeau](https://www.joshwcomeau.com/animation/a-friendly-introduction-to-spring-physics/)).

**Springs in pure CSS via `linear()`.** `linear()` is Baseline Widely Available: Chrome 113, Firefox 112, Safari 17.2 ([webstatus.dev](https://api.webstatus.dev/v1/features/linear-easing)). Comeau found that 40+ points convince where 11 look robotic. Three large springs cost about 1.3 kB gzipped in CSS, and complex `linear()` values had no measurable frame-rate cost ([Comeau, linear()](https://www.joshwcomeau.com/animation/linear-timing-function/)). The main limitation: an interrupted CSS transition doesn't carry velocity the way a JS spring does ([same](https://www.joshwcomeau.com/animation/linear-timing-function/)). Wrap usage in `@supports (animation-timing-function: linear(0, 1))` with a Bézier fallback ([Chrome physics-based easing guide](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/physics-based-easing)).

We generated these strings from the analytic damped-spring equation, simplified with Ramer–Douglas–Peucker to a 0.002 tolerance, with settle time at 0.1% residual. You can paste them as-is:

```css
:root {
  /* tick — Material expressive fast-spatial (k=800, ζ=0.6): ≈360ms, 9.5% overshoot. Checkbox mark, press release. */
  --spring-tick: linear(0, 0.007 1.2%, 0.029 2.5%, 0.07 4%, 0.123 5.5%, 0.179 6.8%, 0.248 8.3%, 0.531 14%, 0.649 16.5%, 0.756 19%, 0.848 21.5%, 0.924 24%, 0.985 26.5%, 1.03 29%, 1.064 31.7%, 1.079 33.5%, 1.089 35.5%, 1.094 37.5%, 1.094 39.7%, 1.081 44.7%, 1.019 58.8%, 1.006 63%, 0.998 67.2%, 0.993 72.2%, 0.991 78%, 1);
  --spring-tick-dur: 360ms;
  /* settle — Material standard default-spatial (k=700, ζ=0.9): ≈320ms, 0.2% overshoot. List reflow and reorder. */
  --spring-settle: linear(0, 0.006 1.3%, 0.022 2.7%, 0.049 4.2%, 0.089 5.8%, 0.176 8.8%, 0.393 15.5%, 0.491 18.7%, 0.585 22%, 0.666 25.3%, 0.733 28.5%, 0.792 31.8%, 0.842 35.3%, 0.884 39%, 0.92 43.2%, 0.949 47.8%, 0.971 53%, 0.986 58.8%, 0.995 65.3%, 1 73.3%, 1);
  --spring-settle-dur: 320ms;
  /* lift — Material expressive default-spatial (k=380, ζ=0.8): ≈435ms, 1.5% overshoot. Sheets and the detail card opening. */
  --spring-lift: linear(0, 0.006 1.3%, 0.025 2.8%, 0.055 4.3%, 0.098 6%, 0.143 7.5%, 0.198 9.2%, 0.428 15.7%, 0.535 18.8%, 0.631 22%, 0.716 25.2%, 0.784 28.2%, 0.843 31.3%, 0.893 34.7%, 0.932 38%, 0.963 41.7%, 0.987 45.7%, 1.003 50.2%, 1.012 55.2%, 1.015 64.8%, 1);
  --spring-lift-dur: 435ms;
}
```

You can also use [Jake Archibald and Adam Argyle's linear() generator](https://linear-easing-generator.netlify.app/), which Comeau recommends ([source](https://www.joshwcomeau.com/animation/linear-timing-function/)).

### 1.3 What to animate

- **Only `transform` and `opacity`**, plus `filter: blur()` sparingly. Padding and margin trigger layout, paint and composite ([Kowalski](https://emilkowal.ski/ui/great-animations)). Stripe animated "exclusively cheap properties" ([De Cock](https://stripe.com/blog/connect-front-end-experience)).
- **Never `transition: all`.** List the properties explicitly ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- **Prefer CSS, then WAAPI, then JS libraries** ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). CSS and WAAPI animations stay smooth when the main thread is busy, while rAF-driven libraries can lag ([Kowalski](https://emilkowal.ski/ui/great-animations)). Scroll-driven CSS animations stayed "completely unaffected" under a heavy JS loop that made the rAF version janky ([Chrome case study, Hirota](https://developer.chrome.com/blog/scroll-animation-performance-case-study)).
- **Scale from the trigger.** Set `transform-origin` to where the element "physically" starts ([Kowalski](https://emilkowal.ski/ui/7-practical-animation-tips), [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Never animate from `scale(0)`; start at 0.9 or higher ([Kowalski](https://emilkowal.ski/ui/7-practical-animation-tips)).
- **Hide crossfade seams** with `filter: blur(2px)` during the swap ([Kowalski](https://emilkowal.ski/ui/7-practical-animation-tips)).
- **Animate a wrapper, not the text node**, to avoid anti-aliasing shifts ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- **Avoid scroll-triggered fade-and-slide-up on every section.** The Anthropic frontend-design skill calls it "the generic default and read as AI-generated" ([skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)).

### 1.4 Interruptibility

- "Waiting out an animation feels broken." UI motion should be interruptible like a book page ([Freiberg](https://rauno.me/craft/interaction-design)). Apple: "Let people cancel motion… don't make people wait for an animation to complete" ([HIG](https://developer.apple.com/design/human-interface-guidelines/motion)).
- **Use CSS *transitions* for interactive state**, because they retarget mid-flight. Keep *keyframes* for one-shot staged sequences ([Krehel](https://jakub.kr/writing/details-that-make-interfaces-feel-better), [Kowalski](https://emilkowal.ski/ui/great-animations)).
- **View Transitions are not interruptible.** "If a new view transition starts while one is already running, the old transition skips to the end," and the page is frozen while the update callback runs ([Chrome docs](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)). Use them for discrete, low-frequency changes such as list switches and moving a task between lists. Don't use them for rapid-fire checkbox toggles.
- **Commit destructive gestures on release, not mid-gesture.** The iOS App Switcher "will never dismiss an app before the gesture ends." Reversing direction should cancel ([Freiberg](https://rauno.me/craft/interaction-design)).

### 1.5 Optimistic UI

- "Update the UI immediately when success is likely; reconcile on server response. On failure, show an error & roll back or provide Undo" ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Prefer Undo over a confirmation for destructive actions ([same](https://github.com/vercel-labs/web-interface-guidelines)).
- Linear's feel rests on a client-side object graph and sync engine, so UI changes don't wait on the network ([Artman, Scaling the Linear Sync Engine](https://linear.app/blog/scaling-the-linear-sync-engine)).
- Atlassian: on drop, "update the UI optimistically, then persist the change asynchronously" ([guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines)).
- **Recommendation for Lists:** write to IndexedDB first, render, queue the sync, and keep a single Undo toast for about 5 s. On 3G this is the difference between "instant" (under 100 ms, [NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)) and a 600–2000 ms round trip.

### 1.6 Keyboard focus treatment

- Use `:focus-visible`, so pointer users don't see rings. Use `:focus-within` for grouped controls. Never let sticky UI cover the focused element ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines); WCAG 2.4.11, explained by [Sara Soueidan](https://www.sarasoueidan.com/blog/focus-indicators/)).
- Size: the indicator area should be at least a **2 CSS px perimeter**, with **≥ 3:1** contrast change between focused and unfocused states and against adjacent colours (SC 2.4.13 / 1.4.11). Prefer `outline` over `box-shadow`, because outlines don't shift layout and survive forced-colors mode. Use `outline-offset` for separation ([Soueidan](https://www.sarasoueidan.com/blog/focus-indicators/)).
- Two-colour rings (`outline: 3px solid black; box-shadow: 0 0 0 6px white`) stay visible on any background ([Soueidan](https://www.sarasoueidan.com/blog/focus-indicators/)).
- In a keyboard-first list, **row focus *is* the selection.** Move it instantly (§1.1) and render it as a solid 2 px accent bar plus a tinted row. Don't animate a sliding highlight on arrow keys ([Kowalski](https://emilkowal.ski/ui/you-dont-need-animations)).

### 1.7 Press states and targets

- `:active { transform: scale(0.97) }` on buttons ([Kowalski](https://emilkowal.ski/ui/7-practical-animation-tips)).
- "Interactions increase contrast": hover, active and focus each get more contrast than rest ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- Hit targets: at least 24 px, and **at least 44 px on mobile**. Label and checkbox share one hit target, with no dead zones ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- Mobile `<input>` font size of at least 16 px prevents iOS zoom ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- Concentric radii: inner = outer − padding ([Paul Hebert, Cloud Four](https://cloudfour.com/thinks/the-math-behind-nesting-rounded-corners/); [Krehel](https://jakub.kr/writing/details-that-make-interfaces-feel-better)).
- Tabular numerals for counts and dates (`font-variant-numeric: tabular-nums`) ([Krehel](https://jakub.kr/writing/details-that-make-interfaces-feel-better), [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- Submenus: Linear's invisible "safe triangle" between the cursor and the submenu lets diagonal mouse paths through, in about 40 lines ([Linear, Invisible details](https://linear.app/blog/invisible-details)).

### 1.8 Sound and haptics

- **Apple's haptics rules:**
  - Keep haptics consistent and causal.
  - Use them to complement visuals, and match their sharpness and intensity to the animation.
  - "Avoid overusing haptics… the best haptic experience is one that people may not be conscious of, but miss when it's turned off."
  - Prefer short haptics for discrete events, and make haptics optional ([HIG Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)).
- **Web reality:**
  - `navigator.vibrate()` takes a duration or a vibrate/pause pattern such as `[200,100,200]` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)).
  - Support is limited to Chromium (Chrome and Edge, including Android); there is none in Safari or Firefox ([webstatus.dev](https://api.webstatus.dev/v1/features/vibration)).
  - iOS Safari has no vibration API. A community trick toggles a hidden `<input type="checkbox" switch>` (the switch control shipped in Safari 17.4, [WebKit](https://webkit.org/blog/15054/an-html-switch-control/)) to get a system tick. It is undocumented, and one tester claims iOS 26.5 patched it ([ios-haptics](https://npmjs.com/package/ios-haptics), [tester](https://rapidtoolset.com/en/tool/ios-haptics-tester)). Treat it as unreliable.
  - **Recommendation:** an Android-only 8–12 ms tick on task completion and on drop (our values), off when `prefers-reduced-motion` is set, with a settings toggle.
- **Sound:**
  - Keep it subtle (volume around 0.25–0.5), trim leading silence, add a keyboard-reachable persisted mute, and never carry information by sound alone ([Josh Comeau, use-sound](https://www.joshwcomeau.com/react/announcing-use-sound-react-hook/)).
  - Apple's motion guidance says to supplement visuals with alternatives such as sound and haptics, because motion shouldn't be the only channel ([HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)).
  - **Recommendation:** synthesize a 30–40 ms filtered-noise "pencil tick" with the Web Audio API (0 bytes of audio download). Make it off by default and opt-in.

### 1.9 List reordering and drag feel

From [Atlassian's Pragmatic drag-and-drop design guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines), which publish real numbers:

- **Drop indicator:** a 2 px line with an 8 px terminal, placed mid-gap. Show none in an empty list.
- **Original item:** stays in place at **opacity 0.4**.
- **Preview:** not rotated (Trello's 4° is the exception), at most 280×280 px, at most three pieces of information.
- **Cursor:** `cursor: grab` only on the draggable part.
- **Drop highlight:** only when a drop is actually possible, at 350 ms.
- **After the drop:** a 700 ms flash on the moved item.
- **Accessibility:** every drag has a menu or keyboard alternative, and a visible handle with a touch target of at least 24×24 px.

Also:

- Disable text selection and set `inert` on the dragged element during a drag ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Every drag needs a tap or keyboard alternative (WCAG 2.5.7) ([same](https://github.com/vercel-labs/web-interface-guidelines)).
- Preserve momentum and direction on release, so a thrown item keeps its throw ([Freiberg](https://rauno.me/craft/interaction-design)).
- Neighbours making room should use a FLIP transform with `--spring-settle` (ζ 0.9, almost no overshoot). For keyboard moves (Alt+↑/↓), reorder instantly and flash the row ([Kowalski](https://emilkowal.ski/ui/you-dont-need-animations) on keyboard actions).
- For non-drag moves (moving a task to another list), use a same-document View Transition with per-item `view-transition-name` and a shared `view-transition-class` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API), [Chrome](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)). These are Baseline Newly Available since 2025-10-14 (Chrome 111, Firefox 144, Safari 18) ([webstatus.dev](https://api.webstatus.dev/v1/features/view-transitions)).

### 1.10 Completion moments

- Cultured Code use motion to "convey information intuitively and make users' operation logic clearer" ([Jainek, sspai](https://www.sspai.com/post/39724)). MacStories singles out the "pop" paired with haptics on iPhone, and the task that pops "into a card-like form while the rest of the list fades" ([MacStories review](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)).
- Anthropic's design skill: "A single orchestrated moment… lands better than scattered effects," and "motion that answers a person's action (opening, expanding, confirming) is welcome when it shows what changed" ([skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)).
- **Design pattern** *(our synthesis of the above)*: every completion gets a brief, precise confirmation, which Apple calls "brevity and precision in feedback animations" ([HIG](https://developer.apple.com/design/human-interface-guidelines/motion)). Only the *rare* event, clearing a whole list, earns the bigger moment.

### 1.11 Platform primitives and support (webstatus.dev, 2026-11-05)

| Feature | Status | Engines | Use in Lists |
|---|---|---|---|
| `prefers-reduced-motion` | Widely available | all | gate every non-essential motion. "Reduced" ≠ "none": keep short fades ([web.dev, Steiner](https://web.dev/articles/prefers-reduced-motion), [Chrome VT docs](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)) |
| `linear()` easing | Widely, 2023-12 | Chrome 113, Firefox 112, Safari 17.2 | springs (§1.2) |
| `@starting-style` + `transition-behavior: allow-discrete` | Newly, 2024-08 | Chrome 117, Firefox 129, Safari 17.5 | enter/exit for popover, dialog and new rows ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style)) |
| Popover API | Newly, 2025-01 | all | menus with no JS positioning lib |
| Same-document View Transitions | Newly, 2025-10 | Chrome 111, Firefox 144, Safari 18 | list switching, move-to-list |
| `view-transition-class` | Newly, 2025-10 | Chrome 125, Firefox 144, Safari 18.2 | one rule for all task rows |
| Cross-document VT (`@view-transition`) | Limited | Chrome 126, Safari 18.2 (no Firefox) | not needed (SPA) |
| Scroll-driven animations | Newly, 2026-10-27 | Chrome 115, Firefox 159, Safari 26 | the header condensing on scroll, off the main thread |
| `text-wrap: pretty` | Limited | Chrome 117, Safari 26 | task notes (progressive) |
| OKLCH / `color()` / `color-mix()` | Widely, 2023 | all | the colour system |
| Relative colour syntax | Newly, 2024-09 | all | hover/pressed derivations |
| `light-dark()` | Newly, 2024-05 | all | theme tokens |
| WebGL2 | Widely, 2021 | all | §5 |
| Vibration | Limited | Chromium only | §1.8 |

Data: [api.webstatus.dev](https://api.webstatus.dev/v1/features/view-transitions) (feature IDs as listed).

---

## 2. The "AI slop" tells, and what distinctive design does instead

### 2.1 What the sources agree on

| Tell | Who names it | Distinctive alternative |
|---|---|---|
| **Purple/indigo accents and purple-blue gradients** | HN: "I just KNEW it would be purple" ([HN 45622944](https://news.ycombinator.com/item?id=45622944)); traced to Tailwind UI's `bg-indigo-500` defaults ([prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website); [Alan West](https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p)); [Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md); [Impeccable](https://impeccable.style/slop) | Derive the palette from the product's own vernacular and name colours by function ([925 Studios](https://www.925studios.co/blog/ai-slop-design-tells)) |
| **Inter (or Geist, Roboto, Arial) everywhere** | [Impeccable](https://impeccable.style/slop); [Krebs](https://www.adriankrebs.ch/blog/design-slop/); [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website); "the issue is… a model defaults to Inter when no typography decision was made" ([925 Studios](https://www.925studios.co/blog/ai-slop-design-tells)) | Make a deliberate type choice with real hierarchy contrast; "use the type treatment itself as an active part of the design" ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)) |
| **The SaaS card kit**: identical rounded cards, one radius on everything, the same `rgba(0,0,0,.1)` shadow, gradient washes | [Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md); "identical card grids", "nested cards", "extreme border radius" ([Impeccable](https://impeccable.style/slop)); "rounded corners and uniform shadows on everything" ([prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)) | Flatten with spacing, type and dividers; let radius encode containment (concentric); choose depth per context |
| **Glassmorphism as decoration** | "a 2021–2022 trend that became an AI crutch" ([Impeccable](https://impeccable.style/slop)); detected in [Krebs' scan](https://www.adriankrebs.ch/blog/design-slop/) | Use blur only to solve a real layering problem |
| **Emoji icons and emoji headings; ✨ sparkles** | Emoji icons in nav ([Krebs](https://www.adriankrebs.ch/blog/design-slop/)); "emoji icons… the vibe coder aesthetic" ([Product Hunt](https://www.producthunt.com/p/opale-ui/i-cracked-the-code-to-building-awwwards-worthy-websites)); sparkles "doing a lot of heavy lifting" ([Matt Hogg](https://dev.to/mrmatthogg/wherein-i-find-myself-concerned-about-sparkles-h63)); ✨ now just means "AI" ([Nielsen](https://blog.jim-nielsen.com/2026/ai-aesthetic/)); "buttons not to click" ([HN](https://news.ycombinator.com/item?id=49117099)) | Icons that depict the concrete action, drawn at text weight ("stroke should match the letters' weight", [HN, piskov](https://news.ycombinator.com/item?id=49117099)) |
| **Centered hero + badge pill + sparkles + three icon cards + stat banner** | [Krebs](https://www.adriankrebs.ch/blog/design-slop/); "1/3 of the page to display 3 icons" ([HN](https://news.ycombinator.com/item?id=45622944)); "big number with a small label… gradient accent is the default treatment" ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)) | Open with the most characteristic thing in the subject's world. For a to-do app, that is a live, usable list |
| **Template chrome**: ALL-CAPS tracked eyebrows, `A · B · C` meta strings, mono micro-labels, `→` on every link, tinted near-black `#0B0B0B` | [Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md); "tiny capitalized monospaced micro-type" ([HN, whywhywhywhy](https://news.ycombinator.com/item?id=49117099)) | Sentence case, labels only where they carry information |
| **The "tasteful" AI default**: cream `#F4F1EA` + high-contrast serif + terracotta `#D97757` | [Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md); [Nielsen](https://blog.jim-nielsen.com/2026/ai-aesthetic/); "looked awesome" until it appeared on every vibe-coded site ([HN, monk_grilla](https://news.ycombinator.com/item?id=49117099)); [avoid-ai-design](https://github.com/funboy322/avoid-ai-design) | Don't trade one default for another |
| **Near-black with a single acid-green or vermilion accent; neon glows; cyan-on-dark** | [Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md); [Impeccable](https://impeccable.style/slop) | Dark themes with real surface lift, accents without glow |
| **Gradient text, radial glows and spotlights** | [Impeccable](https://impeccable.style/slop); [Krebs](https://www.adriankrebs.ch/blog/design-slop/) | Solid colour; emphasis via size or weight |
| **Motion tells**: shimmering "thinking" text reused for any async task, pulsing status dots, fade-up-on-scroll everywhere, bouncy dialogs | [Nielsen](https://blog.jim-nielsen.com/2026/ai-aesthetic/); "`<marquee>` for AI" ([HN, ModernMech](https://news.ycombinator.com/item?id=49117099)); [Impeccable](https://impeccable.style/slop); [Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md) | Animate only real activity; one orchestrated moment |
| **Busyness**: "decoration for the sake of distraction" | [HN, TheOtherHobbes](https://news.ycombinator.com/item?id=49117099) | "Spend your boldness in one place… remove one accessory" ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)) |
| **Copy**: "supercharge", "all-in-one platform", "Not a feature. A platform." | [Impeccable](https://impeccable.style/slop); [925 Studios](https://www.925studios.co/blog/ai-slop-design-tells) | Active voice; a button says what happens; errors don't apologize ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)) |

**Scale of the problem.** Adrian Krebs scored Show HN landing pages against about 16 patterns. 22% of 1,590 sites hit four or more, and only 46% hit at most one ([Krebs](https://www.adriankrebs.ch/blog/design-slop/)). He estimates 5–10% false positives.

### 2.2 Why it happens, and the actual cure

- LLMs output the "on-distribution" average of their training data ([Anthropic skill, as summarised](https://mcpservers.org/agent-skills/anthropic/frontend-design); [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)). An HN commenter calls it "mode collapse" ([HN](https://news.ycombinator.com/item?id=45622944)).
- A working designer on HN: the AI look is "the absence of one: no constraint pushing back" ([HN, dancheong](https://news.ycombinator.com/item?id=49117099)). Jim Nielsen observes that these tools quietly carry design choices a team would otherwise debate ([essay](https://blog.jim-nielsen.com/2026/ai-aesthetic/)).
- **The cure is subject matter.** "The subject's industry, subject matter, materials, and vernacular are where distinctive visual choices come from" ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)).
- Linear's redesign aimed to "reduce visual noise" and pared the theme down to three inputs ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)). Things puts "the user's content in the most visible and important position" and cuts unnecessary decoration ([Jainek](https://www.sspai.com/post/39724)).
- Bret Victor's frame fits a to-do app: "for information software, all interaction is essentially navigation around a data space," so interaction is a last resort ([Magic Ink](https://worrydream.com/MagicInk/)).

**Checklist for Lists** *(our call, derived from §2.1)*: no purple, no Inter or Geist, no glass, no emoji in UI chrome, no ✨, no eyebrow labels, no gradient text, no glows, no uniform card grid, no fade-up-on-scroll, no shimmer except for genuinely in-flight sync, and no cream + serif + terracotta.

---

## 3. Typography

### 3.1 Measured file sizes

**Method.** We requested each family from the Google Fonts CSS2 API with a Chrome 130 user-agent and downloaded the `/* latin */` subset file the API served. Byte counts are on the wire (woff2 is already Brotli-compressed internally). Fontshare files came from `api.fontshare.com/v2/css` and are not latin-subset. We read OpenType feature lists from the TTF variants with a small parser of our own. Sizes as of 2026-11-05.

| Family | Axes served | latin woff2 | `tnum` | License | Notes |
|---|---|---|---|---|---|
| **Mona Sans** (GitHub × Degarism) | wght 200–900 | **39,796 B** | yes | OFL | Google Fonts serves the *same* variable file whether you ask for one weight or a range |
| Mona Sans | wdth 75–125 + wght | **98,064 B** | yes | OFL | width axis is the expressive feature |
| Mona Sans | wght 400 static | 20,920 B | yes | OFL | single instance |
| **Atkinson Hyperlegible Next** (Braille Institute, 2025) | wght 200–800 | **34,024 B** | yes | OFL | |
| **Schibsted Grotesk** (Bakken & Bæck) | wght 400–900 | **46,864 B** | yes | OFL | |
| **Instrument Sans** | wdth 75–100 + wght 400–700 | 57,100 B (wght only: 29,904 B) | yes | OFL | |
| **Switzer** (Fontshare) | variable | 43,220 B (full charset) | not verified | ITF Free Font License | |
| Hanken Grotesk | wght 100–900 | 34,664 B | **no** | OFL | ruled out for a list full of counts and dates |
| IBM Plex Sans | wdth 85–100 + wght | 60,364 B | — | OFL | |
| *Inter (baseline)* | opsz + wght | 73,016 B | yes | OFL | the slop tell |
| *Geist (baseline)* | wght | 29,288 B | — | OFL | named as overused by [Impeccable](https://impeccable.style/slop) |
| Martian Mono (Evil Martians) | wdth + wght | 38,392 B | — | OFL | optional, for shortcut keycaps only |
| Fragment Mono | 400 | 15,176 B | — | OFL | optional |

Family metadata (designers, axes, date added) comes from [fonts.google.com/metadata/fonts](https://fonts.google.com/metadata/fonts). Mona Sans background: [github/mona-sans](https://github.com/github/mona-sans). Atkinson Next release: [Braille Institute / Applied Design](https://lbbonline.com/news/applied-design-launches-atkinson-hyperlegible-next-typeface). Fontshare license: [fontshare.com/licenses](https://www.fontshare.com/licenses).

### 3.2 The candidates, ranked for a dense task list

1. **Mona Sans: our pick.**
   - It's an industrial-era grotesque ([GitHub](https://github.com/github/mona-sans)) with a **width axis (75–125)**. That lets hierarchy come from *width* instead of large size jumps, which matters in a dense list where every pixel of row height counts.
   - Tabular figures are present.
   - It's rarely seen as a product UI face outside GitHub, so it doesn't read as "default". (It isn't on Impeccable's or Krebs' overuse lists.)
   - Cost: 39.8 KB with weight only, or 98 KB with width too.
2. **Atkinson Hyperlegible Next.**
   - The most *principled* choice: designed by Braille Institute for character distinction (l/I/1, O/0), with 7 weights and 150+ languages ([source](https://lbbonline.com/news/applied-design-launches-atkinson-hyperlegible-next-typeface)).
   - 34 KB, and `tnum` is present.
   - Distinctive because its letterforms are visibly purposeful. A strong choice if accessibility is the brand story.
3. **Schibsted Grotesk.** A newspaper-born grotesk with warmth and good small-size colour; 46.9 KB, `tnum`. Beware the "broadsheet" tell if it's paired with hairline-rule layouts ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)).
4. **Instrument Sans.** Compact, with a width axis; 29.9 KB for weight only. It has become common in 2024–25 indie-SaaS sites *(our observation, not sourced)*, so it's slightly less distinctive.
5. **Switzer (Fontshare).** A crisp neo-grotesk, 43 KB. The license is free but not OFL, so self-hosting terms need checking ([Fontshare licenses](https://www.fontshare.com/licenses)).

**Not recommended:** Inter and Geist (tells); Satoshi, Clash, Cabinet, General Sans (common in template marketplaces, *our observation*); serif display faces (the cream-and-serif tell). Apple's guidance applies here: minimise the number of typefaces, and avoid Ultralight/Thin/Light at small sizes ([HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography)). Apple's defaults for comparison are 17 pt on iOS (11 pt minimum) and 13 pt on macOS (10 pt minimum) ([same](https://developer.apple.com/design/human-interface-guidelines/typography)).

### 3.3 3G and Save-Data fallback strategy

1. **Self-host** the latin woff2 on the same origin. That avoids a third-party connection and lets the Service Worker cache it immutably. Use `font-display: swap`.
2. **Metric-matched fallback.** Declare a local fallback face that wraps `system-ui`/Arial with `size-adjust`, `ascent-override`, `descent-override` and `line-gap-override` computed from the webfont, so the swap causes no layout shift. Compute: size-adjust = web-font average glyph width ÷ fallback width; ascent-override = ascent ÷ (UPM × size-adjust). Tools: fontaine, Capsize, next/font ([Chrome: improved font fallbacks](https://developer.chrome.com/blog/font-fallbacks)).
3. **Stack:** `"Mona Sans", "Mona Sans Fallback", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. The modern-font-stacks project documents `system-ui` and neo-grotesque stacks ([modern-font-stacks](https://github.com/system-fonts/modern-font-stacks)).
4. **Save-Data (`Save-Data: on` header, or `navigator.connection.saveData`):** don't fetch the webfont at all, because the system font *is* the design on constrained connections ([MDN Save-Data](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Save-Data)). Vary the HTML response on `Save-Data`, or add the `@font-face` link from JS only when `!navigator.connection?.saveData`.
5. **Two-stage axes** *(our call)*: preload the 39.8 KB weight-only file. After `requestIdleCallback`, if Save-Data is off, swap in the 98 KB width+weight file (same family name, a higher-specificity `@font-face`, cached by the SW). Until the width axis arrives, `font-stretch` is simply a no-op, so the design degrades to weight-only hierarchy.
6. `<input>` text stays at least 16 px on mobile ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).

---

## 4. Color: OKLCH, P3, themes, accents

### 4.1 Why OKLCH

- L is *perceived* lightness, consistent across hues, so contrast becomes predictable. For example, backgrounds with L ≥ 87% work with black text ([Sitnik & Turner, Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)).
- One relative-colour rule derives every hover state: `oklch(from var(--c) calc(l + 0.1) c h)` ([same](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)).
- **Prefer OKLCH over LCH:** LCH drifts blue toward purple when you change lightness or chroma (hues around 270–330), while OKLCH holds hue ([same](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)). Linear adopted LCH for theme generation because it is "one of the closest color spaces to the human eye" and handles surface elevation well ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **Theme architecture to copy:** Linear went from 98 hand-set variables per theme to three inputs (base, accent, contrast), with contrast doubling as a high-contrast accessibility mode ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).

### 4.2 P3 for the MacBook XDR display

- WebKit has supported Display-P3 since 2016. Detect it with `@media (color-gamut: p3)` ([WebKit](https://webkit.org/blog/10042/wide-gamut-color-in-css-with-display-p3/)). The media query is Widely Available ([webstatus.dev](https://api.webstatus.dev/v1/features/color-gamut)).
- Out-of-gamut colours get *clipped* in Chrome and Safari, which can shift hue. So write the sRGB-safe value by default and raise chroma inside `@media (color-gamut: p3)` ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)). `stylelint-gamut` catches mistakes ([same](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)).
- Mixing in a wide-gamut space keeps mid-mixes vivid ([Chrome HD color guide](https://developer.chrome.com/docs/css-ui/high-definition-css-color-guide)), so use `color-mix(in oklch, …)`.
- Test both profiles: macOS lets you switch the display between P3 and sRGB in System Settings → Displays ([HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).

### 4.3 Light, dark and contrast rules

- **Apple's dark-mode rules:**
  - Contrast never below **4.5:1**, and strive for **7:1** for small custom text.
  - Dark palettes are "not necessarily inversions" of light ones.
  - Test with Increase Contrast and Reduce Transparency ([HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)).
  - Every custom colour needs light, dark and increased-contrast variants ([HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).
- Apple also advises *against* an app-specific appearance toggle; follow the system ([HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)). **Recommendation:** default to `color-scheme: light dark`. Offer an override only inside Settings (web users on shared machines sometimes need it), never as a header toggle.
- Don't use one colour to mean two things ([HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).
- Avoid the near-black-plus-acid-accent tell (§2.1). Dark surfaces should have real lift between levels.

### 4.4 Accent system

Two semantic accents at most, each with a fixed meaning (§7 names them), derived with relative colour:

```css
--accent-hover:   oklch(from var(--accent) calc(l - 0.04) c h);
--accent-pressed: oklch(from var(--accent) calc(l - 0.08) calc(c * 1.05) h);
--accent-wash:    color-mix(in oklch, var(--accent) 12%, var(--paper));
```

The full token set and measured contrast ratios are in §7.

---

## 5. WebGL and 3D

### 5.1 Library sizes, measured 2026-11-05

Method: `gzip -9` of jsDelivr minified builds, and esm.sh bundles with `?exports=` for tree-shaken numbers. We cross-checked with [bundlephobia](https://bundlephobia.com/).

| Option | Version | gzip | What it is |
|---|---|---|---|
| **Raw WebGL2**, one fullscreen triangle + fragment shader + IntersectionObserver pause + DPR cap | — | **≈1.1 KB** (1,970 B raw, our module) | no dependency |
| **PicoGL.js** | 0.17.9 (last published 2022-01) | 15.8 KB | thin WebGL2 wrapper |
| **OGL**: Renderer + Program + Mesh + Triangle (tree-shaken) | 1.0.11 | **14.3 KB** | "minimal layers of abstraction" ([OGL README](https://raw.githubusercontent.com/oframe/ogl/master/README.md)); README claims core 8 kB, math 6 kB, extras 15 kB, total 29 kB minzipped |
| OGL full bundle | 1.0.11 | 39.0 KB (bundlephobia: 34.2 KB) | |
| **twgl.js** | 7.0.0 | 21.5 KB (full: 29.3 KB) | "make using the WebGL API less verbose" ([README](https://raw.githubusercontent.com/greggman/twgl.js/master/README.md)) |
| **regl** | 2.1.1 | 28.4 KB (bundlephobia: 37.7 KB) | functional, stateless WebGL ([README](https://raw.githubusercontent.com/regl-project/regl/gh-pages/README.md)) |
| **three.js**: WebGLRenderer + Scene + OrthographicCamera + PlaneGeometry + ShaderMaterial + Mesh (tree-shaken) | 0.187.0 | **≈148 KB** | the renderer pulls in most of the core |
| three.js full (`three.core.min.js` + `three.module.min.js`) | 0.187.0 | 105.3 + 89.4 ≈ **195 KB** (bundlephobia: 185.7 KB) | |

**Verdict for Lists:** for one or two fragment-shader effects, raw WebGL2 at about 1 KB beats every library. Use OGL only if we ever need meshes, cameras or textures. three.js is out of budget for 3G: its tree-shaken minimum is about 130× the raw approach.

### 5.2 Tasteful, restrained WebGL in real products: what they teach

- **GitHub globe** ([Tobias Ahlin, GitHub Engineering](https://github.blog/engineering/user-experience/how-we-built-the-github-globe/)). Ahlin also co-designed Mona Sans ([metadata](https://fonts.google.com/metadata/fonts)).
  - No textures, just lights, geometry and a halo shader, with about 12,000 land dots drawn in one `InstancedMesh` call.
  - An SVG placeholder renders instantly and crossfades to canvas over 600 ms with WAAPI.
  - FPS is monitored, and quality steps down through four tiers if the last 50 frames fall below about 55.5 fps: pixel ratio drops from 2.0 to 1.5, there is less raycasting, and dot density falls to about 65%.
  - Antialiasing stays off, with a shader hiding the edge.
  - The initial rotation comes from the timezone offset, avoiding an IP lookup.
  - This is the template for our progressive-enhancement plan.
- **Stripe Connect** ([Benjamin De Cock](https://stripe.com/blog/connect-front-end-experience)). 3D cubes in *CSS 3D*, not WebGL; WAAPI for sequences; IntersectionObserver to start once and disconnect; and `prefers-reduced-motion` handled in CSS *and* by stopping the JS loop. The lesson: reach for WebGL only when CSS can't do it.
- **Vercel / Next.js Conf prism** ([Vercel blog](https://vercel.com/blog/building-an-interactive-webgl-experience-in-next-js)). An adaptive performance monitor, and the costly reflections confined to the prism and **turned off on mobile**.
- **Linear**: its 2021 release page used a WebGL scene, documented through Maxime Heckel's faithful recreation ([repo](https://github.com/maximeheckel/linear-vaporwave-react-three-fiber)). Linear's *product* stays flat. WebGL lives on marketing and launch moments, not in the issue list (*our observation*).
- **Apple:** we found no primary Apple source for WebGL in its productivity apps. Apple's published guidance is about restraint: "Don't add motion for the sake of adding motion" and "let people customize… to optimize performance or battery life" ([HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)). We don't claim more than that.

### 5.3 Three concrete, non-gimmicky uses in Lists

1. **The cleared-list moment** (the signature, §7). When the last task in Today is completed, the empty state renders the day's actual strikes, one per completed task with lengths from title widths, as a composition lit by a slow raking light. The shader uses a fake paper-grain normal from hash noise and a moving light vector, and follows the pointer gently. It plays once, for about 900 ms, then sits static. Fallback: the same strokes as static SVG.
2. **Focus lamp in focus mode.** In single-task focus mode, a very low-contrast vignette dims the periphery, with brightness tied to the timer. That's one uniform and costs nothing when idle, because we render only on change, not every frame. Fallback: CSS radial gradient.
3. **Drag "lift" shadow (optional; consider cutting).** A soft, physically plausible contact shadow under a dragged task, whose blur and offset follow drag velocity. A CSS `box-shadow` with velocity-mapped custom properties gets about 90% of the way there for 0 KB, so we'd ship CSS and prototype the shader only if CSS looks fake. Following Stripe's lesson, CSS is the default.

### 5.4 Progressive-enhancement gate

```js
// webgl-gate.js — inline (~400 B). Loads the 1 KB shader module only when it can earn its place.
async function canUseGL() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;      // web.dev/articles/prefers-reduced-motion
  if (navigator.connection?.saveData) return false;                              // MDN Save-Data
  if (matchMedia('(prefers-reduced-data: reduce)').matches) return false;        // limited support; harmless
  if ((navigator.hardwareConcurrency || 4) < 4 || (navigator.deviceMemory || 4) < 4) return false;
  try {                                                                           // MDN getBattery: limited availability, HTTPS only
    const b = await navigator.getBattery?.();
    if (b && !b.charging && b.level < 0.2) return false;
  } catch {}
  return !!document.createElement('canvas').getContext('webgl2');
}
// Only when the empty state is actually on screen:
new IntersectionObserver(async ([e], io) => {
  if (!e.isIntersecting || !(await canUseGL())) return;
  io.disconnect();
  const { mountGlow } = await import('/js/glow.js');   // ≈1.1 KB gz, raw WebGL2
  mountGlow(e.target.querySelector('canvas'));        // crossfade from the SVG placeholder via WAAPI (GitHub-globe pattern)
}).observe(document.querySelector('.empty-state'));
```

Rules inside the module:
- Cap DPR at 1.5 (per GitHub).
- Use `powerPreference: 'low-power'` and `antialias: false`.
- Pause on `visibilitychange` and when off-screen.
- Drop to a static frame if two consecutive frames exceed 20 ms.
- Call `WEBGL_lose_context` on unmount.

Sources: [MDN Save-Data](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Save-Data), [MDN getBattery](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getBattery) (limited availability, secure context, Permissions-Policy `battery`), [GitHub globe](https://github.blog/engineering/user-experience/how-we-built-the-github-globe/), [Vercel](https://vercel.com/blog/building-an-interactive-webgl-experience-in-next-js).

---

## 6. Motion libraries vs CSS/WAAPI

| Option | gzip | Strengths | Weaknesses | Source |
|---|---|---|---|---|
| **CSS transitions + `linear()` + `@starting-style` + View Transitions** | **0 KB** (about 1.3 kB of CSS for three springs) | compositor-friendly, interruptible (transitions), respects media queries natively | springs are duration-based and don't carry velocity across interruptions | [Comeau](https://www.joshwcomeau.com/animation/linear-timing-function/), [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style) |
| **WAAPI** (`el.animate`) | 0 KB | "performance and simplicity of CSS @keyframes in JavaScript"; promise-based `finished` for sequencing; accepts `linear()` easing | no physics; verbose for choreography | [De Cock](https://stripe.com/blog/connect-front-end-experience), [Kowalski](https://emilkowal.ski/ui/great-animations) |
| **Hand-rolled spring → WAAPI** | ≈0.5 KB *(our estimate)* | sample the spring at runtime from the *current velocity* and pass it as `linear()` keyframes. That fixes the velocity-on-interrupt gap while staying on WAAPI | you own the code | spring maths: [Comeau](https://www.joshwcomeau.com/animation/a-friendly-introduction-to-spring-physics/); our generator in §1.2 |
| **Motion `animate`, mini** | **3.2 kB** (official) | uses native browser APIs; springs via `type: spring` | no independent transforms, no SVG path | [motion.dev/docs/animate](https://motion.dev/docs/animate) |
| **Motion `animate`, hybrid** | **22 kB** (official) | independent transform axes, CSS vars everywhere, SVG paths, physics springs | weight | same |
| Motion One (`@motionone/dom`) | 8.1 KB (measured) | — | folded into Motion in Nov 2024; last release 10.18.0 (2024-06) | [motion.dev blog](https://motion.dev/blog/framer-motion-is-now-independent-introducing-motion); [npm](https://registry.npmjs.org/@motionone/dom) |
| **GSAP core** | **28.4 KB** (measured; bundlephobia 27.4 KB) | timelines, battle-tested; free including plugins since 30 April 2025 | "Standard no-charge" license, not OSS, with restrictions on competing visual-builder tools; IP stays with Webflow | [Webflow](https://webflow.com/blog/gsap-becomes-free), [GSAP license](https://gsap.com/community/standard-license/) |
| **popmotion** | 6.7 KB (measured) | small spring and decay primitives | last published 2022-08-15 (11.0.5); effectively superseded by Motion | [npm](https://registry.npmjs.org/popmotion) |
| anime.js v4 | 42.7 KB (measured, full ESM) | expressive timelines | heavy for this use | jsDelivr build |

Our esm.sh measurements of the `motion` package came out inflated (12.5 KB mini, 46 KB hybrid) because esm.sh injects a Node-compat shim (`__unenv__`). We quote Motion's own documented 3.2 kB / 22 kB instead.

**Recommendation.** Ship **zero** animation libraries:
- CSS transitions for state, `@starting-style` for enter, View Transitions for list-level changes, and `linear()` springs.
- One small velocity-aware spring helper (~40 lines) on WAAPI for the drag release and the "throw" (§1.9).
- If choreography grows, add Motion mini (3.2 kB) before anything else.
- GSAP's license is the deciding factor against it for a product we may want to open-source, not its size.

This matches the Vercel guideline order: CSS > WAAPI > JS libraries ([WIG](https://github.com/vercel-labs/web-interface-guidelines)).

---

## 7. Design direction we recommend: **"Blue Pencil"**

### 7.1 The idea

The vernacular of lists on paper is the strike. The tool editors and draftsmen have always used for marks that guide but aren't the final work is the **non-photo blue pencil**, plus the **red pencil** for corrections. Lists takes that vocabulary, rather than the generic SaaS kit or the "tasteful AI" cream-and-serif kit:

- **Graphite** for content: cool, precise, quiet.
- **Blue pencil** for *your marks*: done, focus, selection, the strike.
- **Red pencil** for *corrections the day demands*: overdue, conflicts, destructive actions.

Nothing else gets colour. This follows the subject-matter rule ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)) and Apple's one-colour-one-meaning rule ([HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).

**What it deliberately avoids (§2):**
- **Not** cream: the paper is cool white.
- **Not** serif, and **not** Inter.
- **Not** near-black with neon: dark mode is a lifted graphite at L 0.255, and the accent has no glow.
- **Not** cards: the working list has no containers, just rows, a hairline and spacing.
- **No** ALL-CAPS labels: hierarchy comes from the width axis.

### 7.2 Type

One family, **Mona Sans**, where **width is the hierarchy device**:

| Role | Size / line | wght | wdth | Notes |
|---|---|---|---|---|
| List title | 28/32 | 640 | **125** (expanded) | the only large text on screen |
| Task | 15/22 | 430 | 100 | `text-wrap: pretty` for notes |
| Completed task | 15/22 | 400 | **88** (condensed) | it literally *compresses* when done (see motion) |
| Metadata (due, list, count) | 13/18 | 480 | 92 | `font-variant-numeric: tabular-nums` |
| Keycaps in shortcuts | 12/16 | 560 | 100 | `tnum`; no monospace micro-labels |

Fallback: `system-ui` with metric overrides (§3.3). With Save-Data on, there is no webfont at all.

### 7.3 Colour tokens

The ratios below are WCAG 2 contrast against `--paper`, computed from the OKLCH values.

```css
:root {
  color-scheme: light dark;
  /* light: "Paper" */
  --paper:      oklch(0.985 0.004 250);  /* #f8fafd — cool white, not cream */
  --raised:     oklch(1 0 0);            /* sheets, the detail card */
  --rule:       oklch(0.90 0.006 255);   /* hairlines 1.29:1 (decorative only) */
  --ink:        oklch(0.27 0.014 258);   /* #22272d  14.4:1 */
  --ink-2:      oklch(0.48 0.012 258);   /* #595e65   6.3:1 — completed tasks, metadata */
  --ink-3:      oklch(0.62 0.010 258);   /* #82868c   3.5:1 — placeholders/large only */
  --blue:       oklch(0.60 0.13 240);    /* #1a89c5   3.7:1 — strokes, focus ring, checkbox fill (non-text, ≥3:1) */
  --blue-text:  oklch(0.50 0.115 245);   /* #1868a0   5.7:1 — links/selected text */
  --red:        oklch(0.56 0.17 27);     /* #c44039   4.9:1 — overdue, destructive */
}
@media (color-gamut: p3) { :root {
  --blue: oklch(0.60 0.165 240); --blue-text: oklch(0.50 0.14 245); --red: oklch(0.56 0.22 27);
}}
@media (prefers-color-scheme: dark) { :root {
  /* dark: "Graphite" — lifted, never #0B0B0B */
  --paper:  oklch(0.255 0.012 258);  /* #1f2329 */
  --raised: oklch(0.295 0.013 258);
  --rule:   oklch(0.36 0.012 258);
  --ink:    oklch(0.94 0.006 258);   /* 13.2:1 */
  --ink-2:  oklch(0.76 0.010 258);   /*  7.4:1 */
  --ink-3:  oklch(0.62 0.010 258);   /*  4.3:1 */
  --blue:   oklch(0.78 0.115 235);   /*  8.0:1 — pale, pencil-like; no glow, ever */
  --blue-text: oklch(0.80 0.11 235); /*  8.6:1 */
  --red:    oklch(0.72 0.14 27);     /*  6.0:1 */
}}
@media (prefers-color-scheme: dark) and (color-gamut: p3) { :root { --blue: oklch(0.78 0.14 235); --red: oklch(0.72 0.18 27); } }
@media (prefers-contrast: more) { :root { --ink-2: var(--ink); --rule: var(--ink-3); } }
```

All body and metadata text clears Apple's 4.5:1 floor, and primary text clears its 7:1 target ([HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)). Following Linear's three-input approach, the whole set can be generated from `base hue 255`, `accent hue 240` and `contrast` ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).

### 7.4 Spacing and shape

- **4 px base.** Rows are **36 px on desktop** and **44 px on touch** (hit target, [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Group gap is 24 px, list gutter 20 px, and line length stays under 80 characters for notes ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)).
- **Radius encodes containment, not decoration.** The checkbox is a rounded square with a 5 px radius at 18 px. Sheets have a 14 px radius, with inner elements at 14 − padding, so they stay concentric ([Hebert](https://cloudfour.com/thinks/the-math-behind-nesting-rounded-corners/)). Rows have no radius except on the focused row's 6 px wash.
- **Depth only where something floats** (sheet, drag preview, menu): one tight contact shadow plus one ambient shadow. The resting list has no shadows at all.
- **Focus:** a 2 px `--blue` outline at 2 px offset for controls. Focused *rows* get a 2 px left bar plus a `--blue` 10% wash, and move instantly ([Soueidan](https://www.sarasoueidan.com/blog/focus-indicators/)).

### 7.5 Motion signature: "the strike"

| Moment | Behaviour | Tokens |
|---|---|---|
| Press (any control) | `scale(0.97)`, 90 ms out, released on `--spring-tick` | [Kowalski](https://emilkowal.ski/ui/7-practical-animation-tips) |
| **Complete a task (pointer)** | 1) The checkbox fills on `--spring-tick` (360 ms). 2) **A hand-drawn blue-pencil strike** is drawn through the title: an SVG path with `stroke-dashoffset`, 220 ms, Material standard easing, its wobble seeded by the task id so *every strike is unique and stable*. 3) The title settles from wdth 100 to 88 and from `--ink` to `--ink-2` over 180 ms (the line is `contain: layout` so the reflow stays inside one row). 4) After a **1.2 s undo grace**, the row collapses (FLIP on `--spring-settle`) into "Done". Android gets an 8 ms tick; sound is opt-in. | durations within Kowalski's sub-300 ms rule for each step |
| Complete (keyboard `x` / `⌘↵`) | Same end state; the strike draws in **90 ms** and there is no collapse delay. Undo is still in the toast | [Kowalski](https://emilkowal.ski/ui/you-dont-need-animations) on keyboard |
| Reorder (drag) | Atlassian indicators and 0.4 opacity original; neighbours on `--spring-settle`; release carries the throw velocity (WAAPI spring helper); 700 ms blue wash flash on the landed row | [Atlassian](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines), [Freiberg](https://rauno.me/craft/interaction-design) |
| Open the task detail | The row lifts into a `--raised` sheet from its own position (View Transition, `--spring-lift`), and the list behind dims by 6% | [Chrome VT](https://developer.chrome.com/docs/web-platform/view-transitions/same-document), Things' "pop into a card" ([MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)) |
| Switch lists | View Transition crossfade with 4 px of vertical offset, 160 ms; instant from the keyboard | — |
| Menus and popovers | `@starting-style`, 125 ms, scaling from the trigger origin | [Kowalski](https://emilkowal.ski/ui/7-practical-animation-tips), [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style) |
| Sync | No shimmer. A static "Saved" glyph; a single 2 px blue-pencil underline grows only while a write is actually in flight for more than 300 ms | [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines) delays; shimmer is a tell ([Nielsen](https://blog.jim-nielsen.com/2026/ai-aesthetic/)) |
| Reduced motion | The strike appears fully drawn (no draw-on); the width change and collapse happen instantly; transitions become 120 ms opacity fades; no WebGL | [web.dev](https://web.dev/articles/prefers-reduced-motion) |

### 7.6 The one memorable moment: **"Today, struck through"**

When the last task of **Today** is completed:

1. The list doesn't vanish. Its rows fade out, and **their strikes stay behind**: each completed task's blue-pencil mark remains, at its own length and with its own seeded wobble, stacked like a page of crossed-off notes.
2. A **raking-light shader** (raw WebGL2, about 1.1 KB, lazy-loaded through the §5.4 gate) sweeps once across the "paper" over about 900 ms. It catches the graphite grain and the pencil strokes the way light grazes a real page, then comes to rest as a soft pool that follows the pointer at a low gain.
3. One line of type, set in Mona Sans at wdth 125: **"Today is clear."** Underneath sits the count in tabular figures, and nothing else. There's no confetti, no emoji and no sparkles.
4. With reduced motion, Save-Data, a low battery or no WebGL2, the strokes render as static SVG and the light is a still CSS radial gradient. The moment still works, because it's made of *your* data rather than of an effect.

It earns its place because it is rare (once a day at most), made from the user's own work, and respects Apple's "brief and precise" guidance. Everywhere else the product stays quiet, in line with "spend your boldness in one place" ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)).

### 7.7 Risks to watch

- **A pale blue accent on dark can drift toward the "cyan-on-dark" tell** ([Impeccable](https://impeccable.style/slop)). Guard: chroma at most 0.14, no glow, no gradients, and blue used only for marks and focus.
- **Strike-through skeuomorphism can turn twee.** Guard: one stroke style, no paper texture in the working list (grain appears only in the cleared state), and no sound by default.
- **Animating `wdth` causes per-frame layout.** Guard: confine it to the single completing row with `contain: layout`, keep it to 180 ms, and skip it under reduced motion or Save-Data. If profiling on a low-end Android shows jank, snap it instead of animating.
- **The 98 KB width-axis font on 3G.** Guard: the two-stage loading in §3.3. The design reads correctly with the weight axis alone.

---

## Sources

**Interaction and motion essays and guidelines**
- Rauno Freiberg, *Invisible Details of Interaction Design*: https://rauno.me/craft/interaction-design
- Vercel Labs (Rauno Freiberg et al.), *Web Interface Guidelines*: https://github.com/vercel-labs/web-interface-guidelines
- Emil Kowalski, *Great animations*: https://emilkowal.ski/ui/great-animations
- Emil Kowalski, *7 practical animation tips*: https://emilkowal.ski/ui/7-practical-animation-tips
- Emil Kowalski, *You don't need animations*: https://emilkowal.ski/ui/you-dont-need-animations
- Emil Kowalski, Vaul constants (drawer easing): https://raw.githubusercontent.com/emilkowalski/vaul/main/src/constants.ts
- Jakub Krehel, *Details that make interfaces feel better*: https://jakub.kr/writing/details-that-make-interfaces-feel-better
- Paul Hebert (Cloud Four), *The Math Behind Nesting Rounded Corners*: https://cloudfour.com/thinks/the-math-behind-nesting-rounded-corners/
- Josh W. Comeau, *Springs and bounces in native CSS (linear())*: https://www.joshwcomeau.com/animation/linear-timing-function/
- Josh W. Comeau, *A friendly introduction to spring physics*: https://www.joshwcomeau.com/animation/a-friendly-introduction-to-spring-physics/
- Josh W. Comeau, *use-sound*: https://www.joshwcomeau.com/react/announcing-use-sound-react-hook/
- Linear, *How we redesigned the Linear UI*: https://linear.app/now/how-we-redesigned-the-linear-ui
- Linear, *Invisible details (contextual menus)*: https://linear.app/blog/invisible-details
- Tuomas Artman (Linear), *Scaling the Linear Sync Engine*: https://linear.app/blog/scaling-the-linear-sync-engine
- Werner Jainek (Cultured Code) interview, sspai: https://www.sspai.com/post/39724
- MacStories, *Things 3: Beauty and Delight in a Task Manager*: https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/
- Cultured Code blog: https://culturedcode.com/things/blog/
- Apple HIG, Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- Apple HIG, Playing haptics: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Apple HIG, Typography: https://developer.apple.com/design/human-interface-guidelines/typography
- Apple HIG, Color: https://developer.apple.com/design/human-interface-guidelines/color
- Apple HIG, Dark Mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Material Web motion tokens (durations and easing): https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-motion.scss
- AOSP Compose StandardMotionTokens.kt: https://android.googlesource.com/platform/frameworks/support/+/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/StandardMotionTokens.kt
- AOSP Compose ExpressiveMotionTokens.kt: https://android.googlesource.com/platform/frameworks/support/+/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/ExpressiveMotionTokens.kt
- Atlassian, *Pragmatic drag and drop design guidelines*: https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines
- Jakob Nielsen (NN/g), *Response Times: The 3 Important Limits*: https://www.nngroup.com/articles/response-times-3-important-limits/
- Sara Soueidan, *A guide to designing accessible, WCAG-conformant focus indicators*: https://www.sarasoueidan.com/blog/focus-indicators/
- Bret Victor, *Magic Ink*: https://worrydream.com/MagicInk/
- Benjamin De Cock (Stripe), *Connect: behind the front-end experience*: https://stripe.com/blog/connect-front-end-experience

**Web platform**
- MDN, View Transition API: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- Chrome, Same-document view transitions: https://developer.chrome.com/docs/web-platform/view-transitions/same-document
- MDN, @starting-style: https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style
- Chrome, Physics-based easing: https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/physics-based-easing
- Linear() easing generator (Archibald and Argyle): https://linear-easing-generator.netlify.app/
- Chrome, Scroll-driven animation performance case study (Yuriko Hirota): https://developer.chrome.com/blog/scroll-animation-performance-case-study
- web.dev, prefers-reduced-motion (Thomas Steiner): https://web.dev/articles/prefers-reduced-motion
- MDN, Vibration API: https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API
- MDN, Save-Data: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Save-Data
- MDN, Navigator.getBattery(): https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getBattery
- WebKit, An HTML Switch Control: https://webkit.org/blog/15054/an-html-switch-control/
- ios-haptics (community workaround): https://npmjs.com/package/ios-haptics ; tester: https://rapidtoolset.com/en/tool/ios-haptics-tester
- webstatus.dev feature API (support data): https://api.webstatus.dev/v1/features/view-transitions (and /linear-easing, /starting-style, /scroll-driven-animations, /vibration, /color-gamut, /oklab, /relative-color, /light-dark, /popover, /text-wrap-pretty, /webgl2, /cross-document-view-transitions, /view-transition-class)
- Chrome, Improved font fallbacks: https://developer.chrome.com/blog/font-fallbacks
- Modern Font Stacks: https://github.com/system-fonts/modern-font-stacks

**AI-slop critiques**
- Anthropic, frontend-design SKILL.md: https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md
- Jim Nielsen, *The AI Aesthetic*: https://blog.jim-nielsen.com/2026/ai-aesthetic/ ; HN discussion: https://news.ycombinator.com/item?id=49117099
- HN, *Every vibe-coded website is the same page with different words*: https://news.ycombinator.com/item?id=45622944
- Paul Bakaus, Impeccable, *The visible tells of AI design*: https://impeccable.style/slop
- Adrian Krebs, *Scoring Show HN pages for AI design slop*: https://www.adriankrebs.ch/blog/design-slop/
- prg.sh, *Why Your AI Keeps Building the Same Purple Gradient Website*: https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website
- Alan West, *Why every AI-built website looks the same: blame Tailwind's indigo-500*: https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p
- Matt Hogg, *Wherein I find myself concerned about sparkles*: https://dev.to/mrmatthogg/wherein-i-find-myself-concerned-about-sparkles-h63
- 925 Studios, *AI Slop Fonts and Gradients*: https://www.925studios.co/blog/ai-slop-design-tells
- avoid-ai-design: https://github.com/funboy322/avoid-ai-design
- Product Hunt, "vibe coder aesthetic": https://www.producthunt.com/p/opale-ui/i-cracked-the-code-to-building-awwwards-worthy-websites
- Skill directory summary of Anthropic frontend-design: https://mcpservers.org/agent-skills/anthropic/frontend-design

**Typography**
- Google Fonts CSS2 API (measured): https://fonts.googleapis.com/css2 ; metadata: https://fonts.google.com/metadata/fonts
- GitHub Mona Sans: https://github.com/github/mona-sans
- Atkinson Hyperlegible Next launch: https://lbbonline.com/news/applied-design-launches-atkinson-hyperlegible-next-typeface
- Fontshare licenses: https://www.fontshare.com/licenses

**Color**
- Andrey Sitnik and Travis Turner (Evil Martians), *OKLCH in CSS: why we moved from RGB and HSL*: https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl
- Chrome, *High definition CSS color guide*: https://developer.chrome.com/docs/css-ui/high-definition-css-color-guide
- WebKit, *Wide Gamut Color in CSS with Display-P3*: https://webkit.org/blog/10042/wide-gamut-color-in-css-with-display-p3/

**WebGL and motion libraries**
- Tobias Ahlin (GitHub), *How we built the GitHub globe*: https://github.blog/engineering/user-experience/how-we-built-the-github-globe/
- Vercel, *Building an interactive WebGL experience in Next.js*: https://vercel.com/blog/building-an-interactive-webgl-experience-in-next-js
- Maxime Heckel, Linear release-page WebGL recreation: https://github.com/maximeheckel/linear-vaporwave-react-three-fiber
- OGL README: https://raw.githubusercontent.com/oframe/ogl/master/README.md
- twgl.js README: https://raw.githubusercontent.com/greggman/twgl.js/master/README.md
- regl README: https://raw.githubusercontent.com/regl-project/regl/gh-pages/README.md
- jsDelivr builds measured: https://cdn.jsdelivr.net/npm/three@0.187.0/build/ , https://cdn.jsdelivr.net/npm/ogl@1.0.11/+esm , https://cdn.jsdelivr.net/npm/regl@2.1.1/dist/regl.min.js , https://cdn.jsdelivr.net/npm/twgl.js@7.0.0/dist/7.x/ , https://cdn.jsdelivr.net/npm/picogl@0.17.9/build/picogl.min.js , https://cdn.jsdelivr.net/npm/gsap@3.15.1/dist/gsap.min.js , https://cdn.jsdelivr.net/npm/popmotion@11.0.5/dist/popmotion.min.js , https://cdn.jsdelivr.net/npm/@motionone/dom@10.18.0/+esm
- esm.sh tree-shaken bundles: https://esm.sh/
- bundlephobia: https://bundlephobia.com/
- Motion, animate() docs (mini 3.2 kB / hybrid 22 kB): https://motion.dev/docs/animate
- Matt Perry, *Framer Motion is now independent, introducing Motion*: https://motion.dev/blog/framer-motion-is-now-independent-introducing-motion
- Webflow, *GSAP becomes free*: https://webflow.com/blog/gsap-becomes-free ; GSAP Standard License: https://gsap.com/community/standard-license/
- npm registry metadata (versions and dates): https://registry.npmjs.org/
