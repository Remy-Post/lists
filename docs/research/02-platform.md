# 02 — Platform & Devices research

**Team:** Platform & Devices
**Date:** 2026-11-05
**Scope:** The two target devices (16" MacBook Pro, Galaxy S25 Ultra), durable local storage on Android Chrome, network-aware sync, and the 3G performance budget.
**Method:** Primary sources only: Apple, Samsung, MDN and MDN browser-compat-data (BCD), web.dev, Chrome for Developers, WebKit, W3C/WICG specs, Chromium and DevTools source. Every factual claim links to its source.

Each value is labeled one of three ways:

- **Spec:** the vendor publishes it.
- **Source:** it is read from browser source code or BCD.
- **Derived:** it is computed from published numbers. Derived values must be checked on the real device with the snippet in §A.4.

---

## A. Devices

### A.1 16-inch MacBook Pro (current generation)

**Which model.** No 16-inch MacBook Pro uses the base "M5" chip. Apple's current tech-specs page lists the 16-inch only with the **M5 Pro** or **M5 Max**. The 14-inch is the one sold with a base chip, now listed as M6 ([Apple – MacBook Pro tech specs](https://www.apple.com/macbook-pro/specs/)). Apple's support spec sheet names the model "MacBook Pro (16-inch, M5 Pro or M5 Max)" and gives 2026 as the year introduced ([Apple Support 126319](https://support.apple.com/en-ca/126319)). The display is the same panel as the 2021–2025 16-inch models, so everything below also holds for an M1–M4 Pro/Max 16-inch.

| Property | Value | Basis |
|---|---|---|
| Panel | 16.2" (diagonal) Liquid Retina XDR, mini-LED | Spec ([Apple Support 126319](https://support.apple.com/en-ca/126319)) |
| Native resolution | **3456 × 2234 at 254 ppi** | Spec ([apple.com/macbook-pro/specs](https://www.apple.com/macbook-pro/specs/)) |
| Aspect ratio | 3456/2234 = **1.547 : 1** (about 14:9) | Derived |
| Brightness | 1000 nits sustained full-screen and 1600 nits peak (HDR only); SDR up to 1000 nits outdoors | Spec ([Apple Support 126319](https://support.apple.com/en-ca/126319)) |
| Colour | "Wide color (P3)", 1 billion colours, True Tone | Spec ([Apple Support 126319](https://support.apple.com/en-ca/126319)) |
| Refresh | "ProMotion technology for adaptive refresh rates up to 120Hz"; fixed modes 47.95, 48, 50, 59.94 and 60 Hz | Spec ([Apple Support 126319](https://support.apple.com/en-ca/126319)) |
| Top edge | "Actual viewable area is less due to rounded corners at the top" (camera housing) | Spec footnote ([apple.com/macbook-pro/specs](https://www.apple.com/macbook-pro/specs/)) |

**Scaled ("Looks like") resolutions.** Apple's spec pages don't list these. The values below come from the macOS display settings as reported when the 2021 panel shipped ([9to5Mac](https://9to5mac.com/2021/10/19/new-macbook-pro-screen-resolution-options/), [MacRumors](https://www.macrumors.com/2021/09/23/macbook-pro-2021-resolutions/)). This is secondary sourcing, so confirm it in System Settings → Displays.

| "Looks like" | Relationship | Notes |
|---|---|---|
| 2056 × 1329 | "More space" | rendered at 4112 × 2658 and downsampled |
| 1800 × 1169 | intermediate | |
| **1728 × 1117** | **Default.** Exact 2× of the panel | sharpest; no resampling |
| 1496 × 967 | larger text | |
| 1312 × 848 | "Larger text" | |

**devicePixelRatio is 2 at every scaled setting.** macOS's backing scale factor "will be either 1.0 or 2.0" and "is always a whole number" ([Apple – High Resolution Explained](https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Explained/Explained.html)). Scaled modes draw a 2× backing store and resample it to the panel. Browser zoom (⌘+ / ⌘−) changes `devicePixelRatio`, but pinch-zoom does not ([MDN devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)). At the default setting, expect `screen.width × screen.height = 1728 × 1117` and `devicePixelRatio = 2` (Derived).

**CSS viewport at default scaling.** All values are Derived; measure them with §A.4.
- **Maximised window (Chrome or Safari):** `innerWidth = 1728`. `innerHeight` = 1117 minus the menu bar (as tall as the camera housing on notched Macs; read it from `NSScreen.safeAreaInsets.top`, see [Apple – safeAreaInsets](https://developer.apple.com/documentation/appkit/nsscreen/3882821-safeareainsets)), minus the Dock if it's visible, minus the browser's tab strip and toolbar. Expect roughly **1728 × 950–1000**.
- **macOS full screen (green button):** macOS keeps app content **below the camera housing** and paints the top strip black, the same way Safari behaves. Firefox only recently opted out of the letterboxing compatibility mode ([Mozilla bug 1737953](https://bugzilla.mozilla.org/show_bug.cgi?id=1737953)). The web page never sits under the notch, so `env(safe-area-inset-top)` stays 0 on Mac browsers and you don't need notch handling. Expect `innerWidth = 1728` and `innerHeight` ≈ 1117 minus the notch strip, minus the toolbar if "Always show toolbar in full screen" is on.
- **Windowed:** any size. Design for widths from about 900 px (half-screen split) up to 1728 px, and 2056 px at "More space".

**ProMotion and `requestAnimationFrame`.**
- **Chrome:** Chromium browsers run rAF at the display's refresh rate, up to 120 Hz. The WebKit tracking bug says this directly and says Safari is the outlier ([WebKit bug 173434](https://bugs.webkit.org/show_bug.cgi?id=173434)).
- **Safari:** The 120 Hz rAF bug is still **NEW** (open). Safari gates high-rate page rendering behind the "Prefer Page Rendering Updates near 60fps" feature flag, which is on by default. Testers get 120 fps only after turning it off, and Home Screen/Dock web apps use the default flags ([WebKit bug 173434](https://bugs.webkit.org/show_bug.cgi?id=173434)). Plan for **60 fps rAF in Safari and 120 fps in Chrome**.
- **Consequence:** Drive all animation from elapsed time (the `DOMHighResTimeStamp` argument), never from frame counts. Prefer CSS transitions and WAAPI on `transform` and `opacity`, which the compositor runs at the native rate.

**XDR / P3 colour.**
- `color(display-p3 r g b)` is supported in Chrome 111+, Safari 15+ and Firefox 113+ ([BCD css.types.color](https://github.com/mdn/browser-compat-data/blob/main/css/types/color.json)).
- WebKit's recommended pattern is an sRGB declaration first, then the P3 one, or an `@supports` block for custom properties ([WebKit – Wide Gamut Color in CSS](https://webkit.org/blog/10042/wide-gamut-color-in-css-with-display-p3/)).
- `@media (color-gamut: p3)` detects the hardware. Chrome 58+ and Safari 10+ support it. Firefox parses it but always reports sRGB ([BCD media](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json)).
- `@media (dynamic-range: high)` matches devices with "high peak brightness, high contrast ratio, and color depth greater than 24 bit", and the threshold is up to the UA ([MDN dynamic-range](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/dynamic-range)). Support: Chrome 98, Safari 13.1 ([WebKit – Safari 13.1](https://webkit.org/blog/10247/new-webkit-features-in-safari-13-1/)).
- `dynamic-range-limit` (Chrome 136, Safari 26) can cap HDR images so they don't overpower the UI ([BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/dynamic-range-limit.json)).

```css
:root { --accent: rgb(0 122 255); }                       /* sRGB fallback, everywhere */
@media (color-gamut: p3) {
  :root { --accent: color(display-p3 0.0 0.46 1.0); }     /* richer on XDR / AMOLED */
}
@media (dynamic-range: high) {
  /* Optional only: HDR highlights for media. Keep UI chrome SDR. */
  img.hdr { dynamic-range-limit: constrained; }
}
```

### A.2 Samsung Galaxy S25 Ultra

| Property | Value | Basis |
|---|---|---|
| Panel | **6.9" Dynamic AMOLED 2X, Quad HD+ 3120 × 1440, 120 Hz, S Pen support** | Spec ([Samsung UK – S25 series differences](https://www.samsung.com/uk/support/mobile-devices/what-are-the-differences-between-the-galaxy-s25-ultra-s25-plus-and-s25/)) |
| Aspect ratio | 3120/1440 = **19.5 : 9** (2.167) | Derived |
| Resolution setting | Settings › Display › **Screen resolution** (HD+ / FHD+ / QHD+) | Spec ([Samsung US – display troubleshooting](https://www.samsung.com/us/support/troubleshoot/TSG10013258/)) |
| Default resolution | **FHD+ (2340 × 1080)** out of the box, per Samsung Members screenshots. I found no official Samsung statement of the default. | Secondary ([Samsung Members](https://r1.community.samsung.com/t5/others/pengaturan-resolusi-layar-pilih-kualitas-atau-efisiensi-baterai/td-p/32157722)) |
| Refresh | "Motion smoothness": **Adaptive** (up to 120 Hz) or **Standard** (60 Hz). "Availability of 120 Hz may differ by device and application" | Spec ([Samsung – refresh rate how-to](https://www.samsung.com/latin_en/support/mobile-devices/how-to-set-the-display-refresh-rate-on-your-galaxy-phone/)) |
| S Pen | No Bluetooth LE, so **no Air actions**. Hover (Air view) and writing still work | Spec ([Samsung US – Use the S25 Ultra S Pen](https://www.samsung.com/us/support/answer/ANS10004602/)) |

**CSS viewport (Chrome for Android).**
- **How Android maps pixels:** Android maps physical pixels to dp with `px = dp × (dpi / 160)` ([Android – screen densities](https://developer.android.com/training/multiscreen/screendensities)). Chrome's CSS px equals the Android dp, so **DPR = density / 160**.
- **Expected values:** The resolution switch changes the density, not the dp size. At default "Screen zoom":
  - **QHD+:** DPR **3.5**, so 1440/3.5 = 411.4, which gives **`screen.width` = 412** and `screen.height` ≈ 891.
  - **FHD+:** DPR **2.625**, so 1080/2.625 = 411.4, which gives the same **412 × 891**.
  - All of this is Derived. The DevTools device list has no S25 Ultra preset. Its nearest one, "Samsung Galaxy S20 Ultra", is **412 × 915 @ DPR 3.5** ([DevTools EmulatedDevices.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/emulation/EmulatedDevices.ts)). Third-party databases list the S25 Ultra at 412 × 891 @ 3.5 ([yesviz](https://yesviz.com/devices/samsung-s25-ultra/), secondary).
- **Screen zoom changes the width:** Samsung's "Screen zoom" setting changes the density, and therefore the CSS width (larger zoom gives fewer CSS px). **Don't hard-code 412.** Design for **360–440 px**.
- **innerHeight:** 891 minus the status bar, minus Chrome's top toolbar (or a bottom toolbar if the user moved it there; Chrome Android has had that option since June 2025 per [Google blog](https://blog.google/products/chrome/address-bar-position-change/)), minus the gesture area. Measure it (§A.4).

**Display cutout and gesture bar (edge-to-edge).**
- **Gesture bar:** From **Chrome 135**, "the viewport is allowed to extend into Android's gesture navigation bar". Chrome draws a dynamic bottom bar ("the chin") that slides away on scroll ([Chrome – edge-to-edge guide](https://developer.chrome.com/docs/css-ui/edge-to-edge); [Chrome 135 release notes](https://developer.chrome.com/release-notes/135)).
- **Opting in:** Add `viewport-fit=cover`.
- **Bottom-fixed UI:** Pair `env(safe-area-inset-bottom)` with the new, constant `env(safe-area-max-inset-bottom)` (Chrome 135). Don't pad with the live inset, because that thrashes layout ([edge-to-edge guide](https://developer.chrome.com/docs/css-ui/edge-to-edge)).
- **Punch-hole camera:** In a normal tab it sits inside the status bar, so the top inset is 0. It only matters for a `fullscreen` display mode. `safe-area-inset-*` has been supported since Chrome 69 ([BCD env()](https://github.com/mdn/browser-compat-data/blob/main/css/types/env.json); [New in Chrome 69](https://developer.chrome.com/blog/new-in-chrome-69)).

```css
:root { --sab-max: env(safe-area-max-inset-bottom, 36px); }
.bottom-bar {                      /* e.g. the quick-add bar */
  position: fixed; inset-inline: 0;
  padding-bottom: var(--sab-max);
  bottom: calc(env(safe-area-inset-bottom, 0px) - var(--sab-max));
}
```

**Dynamic toolbar and viewport units.**
- **Definitions:** `svh` is sized as if the UA toolbars are expanded, `lvh` as if they're retracted, and `dvh` sits between the two and tracks the current state. `dvh` "do[es] not update at 60fps" and is throttled ([web.dev – viewport units](https://web.dev/blog/viewport-units)).
- **Support:** Chrome 108, Safari 15.4, Firefox 101 ([BCD length](https://github.com/mdn/browser-compat-data/blob/main/css/types/length.json)).
- **Our use:** `min-height: 100svh` for the app shell, so nothing is ever hidden under the toolbar. Don't animate anything against `dvh`.

**Virtual keyboard.**
- **Default since Chrome 108:** On Android, the keyboard **resizes only the visual viewport** (`resizes-visual`). The layout viewport and viewport units stay stable ([Chrome – viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior)).
- **The opt-ins:** `interactive-widget=resizes-content` makes the keyboard shrink the layout viewport, which suits a bottom-anchored "add item" bar that should ride above the keyboard. `overlays-content` resizes nothing. The VirtualKeyboard API (`navigator.virtualKeyboard.overlaysContent`, `env(keyboard-inset-height)`, Chrome 94+) gives you full control ([BCD VirtualKeyboard](https://github.com/mdn/browser-compat-data/blob/main/api/VirtualKeyboard.json), [BCD env()](https://github.com/mdn/browser-compat-data/blob/main/css/types/env.json)).
- **Recommendation:** Use `resizes-content`. Our bottom quick-add bar then stays above the keyboard with plain CSS and no JS.

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
```

**Refresh rate for web content.**
- **What Samsung says:** Adaptive mode raises the rate "up to 120 Hz", with app-dependent availability ([Samsung](https://www.samsung.com/latin_en/support/mobile-devices/how-to-set-the-display-refresh-rate-on-your-galaxy-phone/)).
- **What Chrome does:** Chrome for Android follows the panel's high rate. A Mozilla bug records Chrome reaching 90 fps on a 90 Hz phone where Firefox stayed at 60 ([Mozilla bug 1795138](https://bugzilla.mozilla.org/show_bug.cgi?id=1795138)).
- **What we assume:** 60–120 Hz, varying with content and thermal state, and the same time-based animation rule as on the Mac.

**S Pen.**
- S Pen input arrives as Pointer Events with `pointerType === "pen"` and hover moves.
- BCD notes that **on some Samsung models `(hover: hover)` may incorrectly match** ([BCD media, crbug 41445959](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json)). Never use `hover` alone to decide "desktop". Combine it with `pointer: fine`, and treat hover-only affordances as optional.
- The S Pen hovering can make `any-hover: hover` true on the phone. That's fine: tooltips are allowed, but they must not be required.

**Colour on the phone.** The S25 Ultra's AMOLED is wide-gamut. Whether Chrome for Android reports `color-gamut: p3` depends on the device and the Samsung "Screen mode" (Vivid or Natural). Ship the same sRGB-then-P3 tokens and check on the device.

### A.3 Breakpoints, conditions and sizing

**Breakpoints.** Align them with Android's window size classes (compact under 600, medium 600–839, expanded 840–1199, large 1200–1599, extra-large 1600 and up, all in dp, which equals CSS px) ([Android – window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)). These cover both devices without special cases:

| Class | Query | Who | Layout |
|---|---|---|---|
| Compact | `(width < 600px)` | S25 Ultra portrait (about 412 px) | Single column, bottom quick-add bar, sheet-style detail |
| Compact-height | `(height < 480px)` | Phone landscape (about 891 × 360–400) | Hide the bottom bar, use an inline add row |
| Medium / Expanded | `(600px <= width < 1200px)` | Mac half-screen or narrow window | Two panes: lists rail and items |
| Large | `(1200px <= width < 1600px)` | Mac medium window | Rail, items, and a detail pane on demand |
| Extra-large | `(width >= 1600px)` | Mac maximised at default 1728 (and 2056 at "More space") | Three panes, but cap the text measure (below) |

**Input conditions.** Keep these separate from width:
- `@media (hover: hover) and (pointer: fine)` turns on hover states, denser rows and keyboard-shortcut hints (the Mac).
- `@media (pointer: coarse)` turns on 48 px targets and swipe gestures (the phone).
- Support: `pointer`/`hover` Chrome 41+ (desktop) and 50+ (Android); Safari 9+ ([BCD media](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json)).
- Other queries: `prefers-reduced-motion` (Chrome 74, Safari 10.1) must gate the WebGL and motion work. `display-mode: standalone` (installed PWA) can tighten top chrome. Note that in a Safari *tab* `display-mode: browser` is always true, even in full screen ([BCD media](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json)).

**Touch and click targets.**
- **Android / Material:** at least **48 × 48 dp** per touch target ([Android – accessibility](https://developer.android.com/guide/topics/ui/accessibility/apps)). In Chrome for Android, 1 CSS px = 1 dp, so use **48 × 48 CSS px**. The visible glyph can be smaller if the hit box is padded out.
- **Apple HIG:** iOS/iPadOS controls default to 44 × 44 pt with a 28 × 28 pt minimum. **macOS controls default to 28 × 28 pt with a 20 × 20 pt minimum** ([Apple HIG – Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)). On the Mac, 1 pt = 1 CSS px at default scaling.
- **WCAG 2.2 SC 2.5.8 (AA):** targets at least **24 × 24 CSS px**, or spaced so that 24 px circles around them don't intersect ([W3C Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).
- **Our tokens:** `--hit-coarse: 48px` for the phone. `--hit-fine: 28px` on the Mac, with a 24 px floor. Row height is about 44 px on the Mac and about 52–56 px on the phone.

**Text.**
- **Measure:** About **66 characters** is "widely regarded as ideal", and 45–75 is the satisfactory range. Use `max-inline-size: 66ch` with a unitless `line-height` ([web.dev – Typography](https://web.dev/learn/design/typography)). WCAG 1.4.8 (AAA) caps lines at **80 characters** and asks for at least 1.5 line spacing ([W3C Understanding 1.4.8](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html)).
- **Our cap:** Item titles and notes: `max-inline-size: min(66ch, 100%)`. On the 1728 px Mac this matters, because one full-width column would be about 200 characters.
- **Base size:** HIG defaults are 17 pt on iOS and 13 pt on macOS ([Apple HIG – Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)). On the web: 16 px body on the phone (it also avoids form-zoom quirks) and 14–15 px on the Mac, set in `rem` so browser zoom still works.

### A.4 Measurement snippet (run on both devices, paste the results into PLAN.md)

```js
// paste in DevTools console, or show it in a ?debug overlay
const r = {
  screen: [screen.width, screen.height], avail: [screen.availWidth, screen.availHeight],
  inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
  vv: visualViewport && [visualViewport.width, visualViewport.height],
  p3: matchMedia('(color-gamut: p3)').matches, hdr: matchMedia('(dynamic-range: high)').matches,
  fine: matchMedia('(pointer: fine)').matches, hover: matchMedia('(hover: hover)').matches,
  net: navigator.connection && (({type, effectiveType, downlink, rtt, saveData}) =>
        ({type, effectiveType, downlink, rtt, saveData}))(navigator.connection),
};
let n = 0, t0 = performance.now();
requestAnimationFrame(function f(t) { if (++n < 120) requestAnimationFrame(f);
  else console.log({...r, rafHz: Math.round(120000 / (t - t0))}); });
```

---

## B. Persistence on Android Chrome

### B.1 Storage APIs, durability and eviction

**What to use.** web.dev recommends **IndexedDB** for app data, **Cache Storage** for the app shell, and **OPFS** for file-like content. **localStorage** "should be avoided because it is synchronous". It holds about 5 MB of strings and isn't available in workers ([web.dev – Storage for the web](https://web.dev/articles/storage-for-the-web)).

| API | Quota bucket | Durability notes |
|---|---|---|
| **IndexedDB** | Origin quota (shared with Cache Storage and OPFS) | Transactions are atomic. Since **Chrome 121** the default durability is **`relaxed`**: `complete` fires once data reaches the OS buffer (which "is typically flushed every few seconds"). Pass `{durability: 'strict'}` to wait for disk ([Chrome blog](https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed/); [MDN durability](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/durability)). Relaxed survives a **browser-process kill**, because the data is already in the kernel. Only `strict` covers a power loss or kernel panic. |
| **localStorage** | Separate, about 5 MiB per origin | In Chromium the browser process **batches writes with a default 5-second commit delay**, rate-limited to 60 commits per hour ([Chromium local_storage_impl.cc](https://github.com/chromium/chromium/blob/main/components/services/storage/dom_storage/local_storage_impl.cc)). A browser kill inside that window can lose recent writes. Writes are synchronous on the main thread. |
| **OPFS** | Origin quota | Chrome 86 (desktop) and **Chrome Android 109**; Safari 15.2 ([BCD StorageManager.getDirectory](https://github.com/mdn/browser-compat-data/blob/main/api/StorageManager.json)). Fast sync access handles exist only in workers. That's overkill for a to-do list. |
| **Cache Storage** | Origin quota | App shell and assets, used by the service worker. |

**Quota and eviction.**
- **Chromium quota:** An origin may use **up to 60% of total disk** in both best-effort and persistent modes. The browser as a whole uses at most 80% ([MDN – Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)).
- **Eviction:** Under storage pressure, browsers evict the **least-recently-used origin**, **all of its data at once**, and "skip over origins that have been granted data persistence" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)).
- **Safari:** Safari deletes script-written storage for origins with no user interaction in the last 7 days of use, when tracking prevention is on ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)). web.dev says this doesn't apply to installed PWAs ([web.dev](https://web.dev/articles/storage-for-the-web)). This is relevant if Remy uses Safari on the Mac, and it's another reason the server copy matters.

**`navigator.storage.persist()`.**
- **Support:** Chrome 55, Firefox 57, Safari 15.2 ([BCD](https://github.com/mdn/browser-compat-data/blob/main/api/StorageManager.json)).
- **How Chrome decides:** Chrome shows **no prompt**. It grants or denies silently based on **site engagement, whether the site is installed or bookmarked, and whether it has notification permission**. A denial can be retried later ([web.dev – Persistent storage](https://web.dev/articles/persistent-storage)).
- **What a grant protects:** Once granted, IndexedDB, Cache, localStorage, OPFS and service workers aren't evicted under pressure; only the user can clear them ([web.dev](https://web.dev/articles/persistent-storage)).
- **Practical path:** Install the PWA, then call `persist()` after a user gesture. web.dev advises against calling it on load. Then check `persisted()` and show a quiet "Storage: protected / best-effort" line in Settings.

**`navigator.storage.estimate()`.**
- **Support:** Chrome 61, Firefox 57, Safari 17 ([BCD](https://github.com/mdn/browser-compat-data/blob/main/api/StorageManager.json)). It returns `{usage, quota}`.
- **Caveats:** Chrome reports the quota as 60% of disk regardless of free space, so the numbers are estimates ([web.dev](https://web.dev/articles/storage-for-the-web)). `usageDetails` is Chromium-only.
- **Use:** Diagnostics only. Always handle `QuotaExceededError` on writes.

### B.2 Tab freezing, discarding, bfcache, and the last moment to save

- **States:** active, passive, hidden, **frozen** (freezable tasks such as timers and fetch callbacks are suspended), terminated, and **discarded** (unloaded to save resources; no JavaScript of any kind runs) ([Chrome – Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)).
- **Android freezes background pages after one minute:** Chrome 139 "shortens the time to freezing background pages (and associated workers) from five minutes to one minute on Android" ([Chrome 139 release notes](https://developer.chrome.com/release-notes/139)).
- **Kills fire no events:** When the user swipes the tab away or kills the app, "the `beforeunload`, `pagehide`, and `unload` events are not fired". The **hidden** state (`visibilitychange` to `hidden`) is "the last state change that's reliably observable by developers" ([Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)).
- **Discards fire no events:** A discarded page sees no event at all. It finds out on reload through `document.wasDiscarded` (Chromium 68+). The docs note this is fully supported on desktop, with Android tracked separately ([Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api); [BCD Document](https://github.com/mdn/browser-compat-data/blob/main/api/Document.json)).
- **unload and beforeunload:** "Never use the unload event". Chrome has deprecated it, and it also blocks bfcache. Only add `beforeunload` while there's unsaved work ([Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api); [web.dev – bfcache](https://web.dev/articles/bfcache)).
- **bfcache:** Restores fire `pageshow` with `event.persisted === true`. `Cache-Control: no-store` on the document and open IndexedDB connections or transactions can keep a page out of bfcache. **Close IDB connections in `pagehide`/`freeze` and reopen them in `pageshow`/`resume`** ([web.dev – bfcache](https://web.dev/articles/bfcache)). `freeze` and `resume` are Chromium-only (68+) ([BCD Document](https://github.com/mdn/browser-compat-data/blob/main/api/Document.json)).

**Synchronous vs asynchronous saving.**
- Don't keep edits only in memory and wait for a lifecycle event. On Android the process can die with no event, and `hidden` is only the *last chance*.
- Commit each user mutation to IndexedDB **as it happens**: one small transaction per mutation, typing debounced to about 250–300 ms, plus a flush on `blur` and Enter.
- On `visibilitychange` to hidden, synchronously *start* the transaction for anything pending. The page isn't frozen for about 60 s on Android, so an async IDB commit started in `hidden` completes. The danger is only in work you haven't started yet.
- Synchronous localStorage doesn't buy durability in Chromium, because of the 5-second commit delay (above). Don't use it as the safety net.
- For edit-log writes, use `{durability: 'strict'}` to be safe against power loss. The writes are tiny and infrequent, so the cost is negligible. Use the default (`relaxed`) for bulk sync imports.

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    store.flushPending();            // starts the IDB transaction now; don't await anything first
    sync.maybeBeacon();              // optional: fetch(url, {method:'POST', keepalive:true, body})
  }
});
addEventListener('pagehide', () => db.close());
addEventListener('pageshow', e => { if (e.persisted) db.reopen(); });
```

### B.3 PWA install requirements (Chrome, current)

**Chrome's installability criteria** ([web.dev – install criteria](https://web.dev/articles/install-criteria)):
- **HTTPS.**
- **Engagement:** the user has clicked or tapped at least once and viewed the page for at least 30 seconds, at any time.
- **Manifest:** `name` or `short_name`; icons including **192 px and 512 px**; `start_url`; `display` set to `fullscreen`, `standalone`, `minimal-ui` or `window-controls-overlay`; `prefer_related_applications` absent or false.

**Service worker.**
- **Menu install** no longer needs a service worker with a `fetch` handler: since **Chrome 108 on Android** and 112 on desktop.
- **The automatic install prompt** "still requires the presence of a `fetch()` handler" ([Chrome blog – update install criteria](https://developer.chrome.com/blog/update-install-criteria)).
- We need a fetch handler for offline anyway.

**Maskable icons.**
- Keep the logo inside a central circle whose **radius is 40% of the icon width**.
- Ship **separate** `"purpose": "any"` and `"purpose": "maskable"` icons. Using maskable icons as `any` adds padding ([web.dev – maskable icons](https://web.dev/articles/maskable-icon)).

**theme-color.**
- **Chrome Android 92+:** colours the browser UI.
- **Chrome desktop:** only in installed PWAs.
- **Safari 26+:** only in installed web apps ([BCD meta](https://github.com/mdn/browser-compat-data/blob/main/html/elements/meta.json)).
- Use `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="…">` pairs, and update them from JS when the user's theme changes.

**Display modes.** Use `"display": "standalone"`. It gives the most native feel on Android, where it installs as a WebAPK, and on the Mac (its own Dock window). `fullscreen` isn't supported for `display-mode` in Chrome for Android and would hide the status bar ([BCD media](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json)).

**Minimal manifest** (`/manifest.webmanifest`, served as `application/manifest+json`):

```json
{
  "id": "/", "name": "Lists", "short_name": "Lists",
  "start_url": "/?source=pwa", "scope": "/", "display": "standalone",
  "background_color": "#0e0e10", "theme_color": "#0e0e10",
  "icons": [
    {"src": "/icons/any-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "/icons/any-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
  ],
  "shortcuts": [{"name": "Today", "url": "/#today"}]
}
```

---

## C. Network-aware sync

### C.1 Network Information API (`navigator.connection`)

Support is from MDN BCD ([api/NetworkInformation.json](https://github.com/mdn/browser-compat-data/blob/main/api/NetworkInformation.json)):

| Field | Chrome desktop (macOS) | Chrome Android | Safari (mac/iOS) | Firefox |
|---|---|---|---|---|
| `type` (`wifi`, `cellular`, …) | **No.** "Only supported on ChromeOS" | **Yes** | No | No (removed) |
| `effectiveType` (`slow-2g`/`2g`/`3g`/`4g`) | Yes | Yes | No | No |
| `downlink` (Mbps) | Yes, **capped at 10 Mbps** (anti-fingerprinting) | Yes, capped at 10 | No | No |
| `rtt` (ms) | Yes, **capped at 3000 ms** | Yes, capped at 3000 | No | No |
| `saveData` | Yes (Chrome 65+) | Yes | No | No |
| `change` event | Yes | Yes | No | No |
| Available in workers | Yes | Yes | No | No |

**How the values are computed.**
- `rtt` is rounded to 25 ms and `downlink` to 25 kbps.
- `effectiveType` comes from observed RTT and throughput. The spec's table: slow-2g means RTT of 2000 ms or more (or downlink at most 50 kbps), 2g means 1400 ms or more (or at most 70 kbps), 3g means 270 ms or more (or at most 700 kbps), and everything else is 4g ([WICG Network Information spec](https://wicg.github.io/netinfo/)).

**Implications.**
- On the **phone**, `type === 'wifi'` is the "good connection" signal.
- On the **Mac**, `type` doesn't exist, so use `effectiveType === '4g'` plus `rtt`.
- In **Safari**, nothing exists, so time our own `/sync/ping` (a tiny request) and use the result.
- `saveData` must be respected for enhancement assets, as GOALS.md requires.
- Chrome's Lite mode was removed in M100 ([Chrome Help](https://support.google.com/chrome/answer/2392284?hl=en)). DevTools can still emulate `Save-Data` ([What's new in DevTools 134](https://developer.chrome.com/blog/new-in-devtools-134)).
- **Testing gotcha:** DevTools "3G" uses a 2000 ms request latency (see C.3). Under that preset, Chrome's estimate will likely read `slow-2g` or `2g`, not `3g`. Our gate has to treat that as "poor", which is the behaviour we want. Write the test expectation that way.

### C.2 Background Sync and Periodic Background Sync

| | One-off Background Sync (`registration.sync`) | Periodic Background Sync (`registration.periodicSync`) |
|---|---|---|
| Support | Chrome/Edge 49+ (desktop and Android). **Not Safari, not Firefox** ([BCD SyncManager](https://github.com/mdn/browser-compat-data/blob/main/api/SyncManager.json)) | Chrome 80+. Not Safari or Firefox ([BCD PeriodicSyncManager](https://github.com/mdn/browser-compat-data/blob/main/api/PeriodicSyncManager.json)) |
| When it fires | When the device has connectivity: immediately if online, otherwise later, **even after the tab is closed** (the SW is the target). Registering needs an open window ([Chrome blog – background sync](https://developer.chrome.com/blog/background-sync)) | Browser-controlled timing. **Installed PWA only.** Never fires if the site-engagement score is 0, and frequency scales with engagement. Only on a **previously connected network**. Considers power and connectivity. Gated by the `periodic-background-sync` permission ([Chrome – Periodic Background Sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync)) |
| Hard limits (Chromium source) | **3 attempts**; first retry after **5 min**, then ×3 backoff; each `sync` event may run for at most **3 minutes** ([background_sync_parameters.cc](https://github.com/chromium/chromium/blob/4e1b7bc33d42b401d7d9ad1dcba72883add3e2af/content/public/browser/background_sync_parameters.cc)) | **Minimum 12 hours** between periodic events, whatever `minInterval` asks for ([same file](https://github.com/chromium/chromium/blob/4e1b7bc33d42b401d7d9ad1dcba72883add3e2af/content/public/browser/background_sync_parameters.cc)) |

**How we use them.**
- One-off sync means "online", not "good". In the SW's `sync` handler, read `self.navigator.connection` (available in workers) and skip the push on poor links. Resolve, don't reject, so retries aren't wasted.
- Treat both APIs as progressive enhancement. Sync also runs on app open, on `online`, on `visibilitychange` to visible, and on demand.
- Periodic sync (12 h or more) is a nice-to-have "keep the backend copy fresh" path for the installed Android PWA.

### C.3 Chrome DevTools throttling presets (current DevTools source)

**The presets were renamed in May–June 2024.** The old "**Slow 3G**" is now labelled "**3G**", and the old "**Fast 3G**" is now "**Slow 4G**". A "**Fast 4G**" preset was added. The exact values come from [`front_end/core/sdk/NetworkManager.ts`](https://github.com/ChromeDevTools/devtools-frontend/blob/cd4a47576027083f7da8b37e2eebcf3adaf9a011/front_end/core/sdk/NetworkManager.ts), which notes the "Fast 3G" to "Slow 4G" rename "in May 2024 to align with LH (crbug.com/342406608)". DevTools multiplies target RTT and throughput by correction factors because it throttles per request:

| Preset (UI label) | Former name | Target RTT | **Latency sent** | **Download** | **Upload** |
|---|---|---|---|---|---|
| **3G** | Slow 3G | 400 ms | **2000 ms** (400 × 5) | 500 kbps × 0.8 = **400 kbps = 50,000 B/s** | **50,000 B/s** (400 kbps) |
| **Slow 4G** | Fast 3G | 150 ms | **562.5 ms** (150 × 3.75) | 1.6 Mbps × 0.9 = **180,000 B/s** (1.44 Mbps) | 750 kbps × 0.9 = **84,375 B/s** (675 kbps) |
| **Fast 4G** | (new) | 60 ms | **165 ms** (60 × 2.75) | 9 Mbps × 0.9 = **1,012,500 B/s** | 1.5 Mbps × 0.9 = **168,750 B/s** |

- **Lighthouse:** Lighthouse's default mobile profile is "Slow 4G" (150 ms, 1.6 Mbps down, 750 kbps up) with a **4× CPU slowdown**. It's simulated rather than applied per request, so its numbers aren't directly comparable to DevTools ([Lighthouse throttling docs](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md)).
- **DevTools CPU presets:** no throttling, **4×** ("mid-tier mobile"), **6×** ("low-tier mobile") and **20×** ("extra slow") ([CPUThrottlingOption.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/panels/common/CPUThrottlingOption.ts)). The combined presets are labelled "Slow 3G & 6x CPU slowdown" (low-tier) and "Fast 3G & 4x CPU slowdown" (mid-tier) ([ThrottlingPresets.ts](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/panels/mobile_throttling/ThrottlingPresets.ts)).
- **Calibration:** DevTools can now calibrate the CPU presets to the host machine (Settings › Throttling › Calibrate) ([Chrome – throttling settings](https://developer.chrome.com/docs/devtools/settings/throttling)).

**The same conditions in Playwright via CDP** (Chromium only). The CDP units are **bytes per second** and milliseconds ([Network.pdl](https://github.com/ChromeDevTools/devtools-protocol/blob/b0d96c6cdf39e5583e67a3762b2815a33154455b/pdl/domains/Network.pdl); [Emulation.pdl](https://github.com/ChromeDevTools/devtools-protocol/blob/b0d96c6cdf39e5583e67a3762b2815a33154455b/pdl/domains/Emulation.pdl); [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession)):

```js
// tests/throttle.js: DevTools "3G" + mid-tier CPU
export const PRESETS = {
  '3G':      { latency: 2000,  downloadThroughput: 50000,   uploadThroughput: 50000,  connectionType: 'cellular3g' },
  'Slow 4G': { latency: 562.5, downloadThroughput: 180000,  uploadThroughput: 84375,  connectionType: 'cellular4g' },
  'Fast 4G': { latency: 165,   downloadThroughput: 1012500, uploadThroughput: 168750, connectionType: 'cellular4g' },
};
export async function throttle(page, name = '3G', cpu = 4) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PRESETS[name] });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });   // 1 = none, 4 = mid-tier, 6 = low-tier
  return cdp;
}
```

**About these CDP commands.**
- `Network.emulateNetworkConditions` is now marked **deprecated** in the protocol, but it still works. It is "deprecated in favor of the `emulateNetworkConditionsByRule` and `overrideNetworkState` commands". Both replacements are experimental. `ByRule` throttles per URLPattern and "does not affect `navigator` state", so pair it with `overrideNetworkState` if `navigator.connection` should reflect the emulated link ([Network.pdl](https://github.com/ChromeDevTools/devtools-protocol/blob/b0d96c6cdf39e5583e67a3762b2815a33154455b/pdl/domains/Network.pdl)).
- `Emulation.setCPUThrottlingRate {rate}` takes a slowdown factor ([Emulation.pdl](https://github.com/ChromeDevTools/devtools-protocol/blob/b0d96c6cdf39e5583e67a3762b2815a33154455b/pdl/domains/Emulation.pdl)).

### C.4 Performance budget for 3G

**What web.dev says.**
- Budgets can be quantity-based (bytes, requests), milestone timings (FCP, TTI) or rule-based (Lighthouse scores).
- Its example budget: **under 170 KB of compressed critical-path resources** and **under 5 s TTI on slow 3G** on a baseline phone. "Use 3G network speed as a starting point" ([web.dev – Performance budgets 101](https://web.dev/articles/performance-budgets-101)).
- Keep above-the-fold content under **14 KB compressed**: about 10 TCP packets, the first round trip ([web.dev – Extract critical CSS](https://web.dev/articles/extract-critical-css)).

**Critical request chains.**
- Minimise the number of critical resources (eliminate, defer, `async`), minimise critical bytes, and shorten the chain length.
- In Lighthouse 13 this audit moved into the "**Network dependency tree**" insight ([Chrome – critical request chains](https://developer.chrome.com/docs/lighthouse/performance/critical-request-chains)).

**What this means under DevTools "3G".** Latency is 2 s **per request**, and transfer is 50 KB/s.
- **Cold load:** Every *serial* hop costs at least 2 s. HTML (2 s + transfer), then CSS and JS fetched **in parallel** (2 s + transfer). That puts first paint at about **4.5–5 s** for a 50 KB critical path. Every extra level, such as a JS `import` waterfall, a CSS `@import`, or a font discovered from CSS, adds **another 2 s or more**.
- **Rules:**
  - Exactly one CSS file and one JS file, both linked from the HTML `<head>`, so they're discovered in the first parse.
  - Bundle or `modulepreload` every ES module the shell needs, so there are no import chains.
  - No CSS `@import`.
  - The app shell's markup and critical inline styles in the HTML, under 14 KB compressed, so the first byte batch can paint.
  - Everything else (WebGL, extra fonts, icons beyond the shell) after first interaction, and never when `saveData` is set.
- **Repeat visits:** The service worker serves the shell from Cache Storage, so network time is roughly 0. That's the real "fast on 3G" experience; the cold load is a one-time cost.

**Fonts** ([web.dev – Font best practices](https://web.dev/articles/font-best-practices)).
- **System font stack for first paint** (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). SF Pro on the Mac and Samsung's system font on the phone render at zero cost.
- If a brand or display face is used, follow these rules:
  - **WOFF2 only.**
  - **Subset** it to Latin with `unicode-range`. Note that `preload` ignores `unicode-range`.
  - Self-host it on the same origin, which avoids a second connection's 2 s.
  - Inline the `@font-face` rules in the `<head>`, but don't inline the font files.
  - Use **`font-display: optional`**, which blocks rendering for at most 100 ms and causes no swap layout shift, or `swap` paired with `size-adjust` fallback metrics.
  - Only `preload` a font if it's needed for first paint. Ours isn't.

**Compression in Caddy.**
- **Built-in `encode`:** supports **zstd** (preferred) and **gzip**, both on by default, with a minimum response size of 512 B and text, JS, JSON, SVG, font and wasm types matched by default ([Caddy – encode](https://caddyserver.com/docs/caddyfile/directives/encode)). There is no on-the-fly Brotli.
- **Brotli:** Ship pre-compressed `.br` (and `.zst`/`.gz`) sidecar files built at deploy time and serve them with `file_server { precompressed br zstd gzip }`. Caddy picks them by `Accept-Encoding` ([Caddy – file_server](https://caddyserver.com/docs/caddyfile/directives/file_server)). This costs zero CPU per request, which matters on a shared VM.
- **Browser support:** Brotli in Chrome 50 (Android 51) and Safari 11. zstd in **Chrome 123** and **Safari 26.3** ([BCD Content-Encoding](https://github.com/mdn/browser-compat-data/blob/main/http/headers/Content-Encoding.json)).

```caddyfile
lists.remypost.me {
	root * /srv/lists.remypost.me/dist
	encode zstd gzip                       # fallback for anything not pre-compressed (e.g. API JSON)
	file_server {
		precompressed br zstd gzip         # serves app.js.br etc. built by `npm run build`
	}
	@hashed path /assets/*
	header @hashed Cache-Control "public, max-age=31536000, immutable"
	header /sw.js Cache-Control "no-cache"
	header /index.html Cache-Control "no-cache"
	reverse_proxy /api/* 127.0.0.1:8787
}
```

---

## Decisions we recommend

1. **Viewport meta:** `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`. Size the app shell with `min-height: 100svh`. Bottom-fixed UI uses the `safe-area-max-inset-bottom` pattern. Don't animate against `dvh`.
2. **Breakpoints:** compact under 600, medium 600–1199, large 1200–1599, extra-large 1600 and up (CSS px, matching Android window size classes), plus `(height < 480px)` for phone landscape. Choose density and hover affordances with `(hover: hover) and (pointer: fine)`, never with width or `hover` alone (the Samsung `hover` bug and the S Pen). Use container queries inside panes.
3. **Don't hard-code device numbers.** Design for phone widths of 360–440 px, with 412 expected, and Mac widths of 900–2056 px, with 1728 expected maximised. Run the §A.4 snippet on both real devices and record the results in PLAN.md before visual tuning.
4. **Targets and type:**
   - Targets: 48 px on coarse pointers. On fine pointers, 28 px, never below 24 px.
   - Body text: 16 px on the phone, 14–15 px on the Mac, in `rem`.
   - Measure: `max-inline-size: 66ch`.
   - Line height: unitless, 1.4–1.6.
5. **Colour:** Define colour tokens in sRGB with P3 overrides inside `@media (color-gamut: p3)`. Keep the UI SDR. HDR is opt-in for media only, with `dynamic-range-limit`.
6. **Motion:** All animation is time-based, with no frame counting. Assume 120 Hz in Chrome (Mac and phone) and 60 Hz rAF in Safari. Prefer compositor-only properties. Honour `prefers-reduced-motion`. WebGL loads only after interaction and never on `saveData`.
7. **Storage:**
   - **IndexedDB is the only source of truth**, written as an append-only op log plus materialised lists. Every user mutation is committed as its own transaction within about 300 ms, using `{durability:'strict'}` for the edit log.
   - No user data in localStorage. Its 5 s commit delay in Chromium makes it *less* durable, not more. localStorage and sessionStorage are only for trivial UI preferences and view state.
   - On `visibilitychange` to hidden, start flushing anything pending immediately. Close IDB on `pagehide`/`freeze`, reopen on `pageshow`/`resume`. Never use `unload`.
   - Request `navigator.storage.persist()` after the PWA install or a meaningful gesture, and show the result in Settings. Treat the server copy as the backup against eviction, which matters especially for Safari's 7-day rule.
8. **PWA:**
   - `display: standalone` with separate `any` and `maskable` icons at 192 and 512.
   - `theme-color` pairs for light and dark.
   - A service worker **with a fetch handler**: precache the shell, network-first for `/api`.
   - Serve `index.html` and `sw.js` with `no-cache`, and hashed assets as `immutable`.
9. **Sync gate:** Sync runs only if the backend copy is stale past the threshold, or the user asked for it, **and** the connection is good. "Good" means:
   - `type === 'wifi'` on the phone, or
   - `effectiveType === '4g' && rtt <= 300 && !saveData` where `navigator.connection` exists (Chrome on the Mac has no `type`), or
   - our own timed ping (round trip ≤ 300 ms) where it doesn't (Safari).

   Re-evaluate on `connection.change`, `online`, visibility changes and app open.
10. **Background Sync:** Use one-off `sync` as a Chrome-only enhancement, with the same gate checked inside the SW and resolved (not rejected) when the link is poor, because Chrome only allows 3 attempts. Register periodic sync at the 12 h minimum on the installed Android PWA only. Never depend on either.
11. **Test harness:** Playwright with CDP `Network.emulateNetworkConditions` at the exact DevTools "3G" numbers (2000 ms / 50,000 B/s / 50,000 B/s) plus `Emulation.setCPUThrottlingRate` 4, and a second pass at "Slow 4G". Assert:
    - first paint at 5 s or less cold on "3G",
    - interaction from the SW cache at 1 s or less on repeat visits,
    - the sync gate reports "poor" under "3G".
12. **Budget and delivery:**
    - Critical path: one HTML file of 14 KB or less, compressed, containing the shell markup and critical CSS; one CSS file; one bundled JS module. Total 50 KB gzip or less (Brotli will come in smaller).
    - No `@import`, no module waterfalls, no web font in the critical path. System fonts first; an optional WOFF2 Latin subset with `font-display: optional`.
    - Caddy serves build-time `.br`/`.zst`/`.gz` files via `file_server precompressed br zstd gzip`, with `encode zstd gzip` as the fallback.

---

## Sources

**Devices**
- Apple – MacBook Pro tech specs: https://www.apple.com/macbook-pro/specs/
- Apple Support – MacBook Pro (16-inch, M5 Pro or M5 Max) specs: https://support.apple.com/en-ca/126319
- Apple – High Resolution Explained (backing scale factor): https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Explained/Explained.html
- Apple – NSScreen.safeAreaInsets: https://developer.apple.com/documentation/appkit/nsscreen/3882821-safeareainsets
- Apple HIG – Accessibility (control and text sizes): https://developer.apple.com/design/human-interface-guidelines/accessibility
- 9to5Mac – MacBook Pro scaled resolutions (secondary): https://9to5mac.com/2021/10/19/new-macbook-pro-screen-resolution-options/
- MacRumors – 2021 MacBook Pro resolutions (secondary): https://www.macrumors.com/2021/09/23/macbook-pro-2021-resolutions/
- Mozilla bug 1737953 – full screen and the notch: https://bugzilla.mozilla.org/show_bug.cgi?id=1737953
- WebKit bug 173434 – 120 Hz requestAnimationFrame: https://bugs.webkit.org/show_bug.cgi?id=173434
- Mozilla bug 1795138 – high refresh on Android: https://bugzilla.mozilla.org/show_bug.cgi?id=1795138
- Samsung UK – S25 series differences: https://www.samsung.com/uk/support/mobile-devices/what-are-the-differences-between-the-galaxy-s25-ultra-s25-plus-and-s25/
- Samsung US – display troubleshooting (screen resolution setting): https://www.samsung.com/us/support/troubleshoot/TSG10013258/
- Samsung – set the display refresh rate: https://www.samsung.com/latin_en/support/mobile-devices/how-to-set-the-display-refresh-rate-on-your-galaxy-phone/
- Samsung US – Use the Galaxy S25 Ultra S Pen: https://www.samsung.com/us/support/answer/ANS10004602/
- Samsung Members – FHD+ default (secondary): https://r1.community.samsung.com/t5/others/pengaturan-resolusi-layar-pilih-kualitas-atau-efisiensi-baterai/td-p/32157722
- yesviz – S25 Ultra viewport (secondary): https://yesviz.com/devices/samsung-s25-ultra/
- Android – screen densities: https://developer.android.com/training/multiscreen/screendensities
- Android – window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- Android – accessibility (48 dp targets): https://developer.android.com/guide/topics/ui/accessibility/apps
- DevTools EmulatedDevices.ts: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/emulation/EmulatedDevices.ts
- Google blog – address bar at the bottom: https://blog.google/products/chrome/address-bar-position-change/

**CSS, viewport and colour**
- Chrome – edge-to-edge migration guide: https://developer.chrome.com/docs/css-ui/edge-to-edge
- Chrome 135 release notes: https://developer.chrome.com/release-notes/135
- New in Chrome 69 (display cutouts): https://developer.chrome.com/blog/new-in-chrome-69
- Chrome – viewport resize behavior (interactive-widget): https://developer.chrome.com/blog/viewport-resize-behavior
- web.dev – viewport units: https://web.dev/blog/viewport-units
- WebKit – Wide Gamut Color in CSS: https://webkit.org/blog/10042/wide-gamut-color-in-css-with-display-p3/
- WebKit – Safari 13.1 features: https://webkit.org/blog/10247/new-webkit-features-in-safari-13-1/
- MDN – dynamic-range: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/dynamic-range
- MDN – devicePixelRatio: https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
- MDN BCD data files (media, env, length, color, meta, dynamic-range-limit, VirtualKeyboard, Document, StorageManager, NetworkInformation, SyncManager, PeriodicSyncManager, Content-Encoding): https://github.com/mdn/browser-compat-data
- web.dev – Typography: https://web.dev/learn/design/typography
- W3C – Understanding SC 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- W3C – Understanding SC 1.4.8 Visual Presentation: https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html

**Storage and lifecycle**
- MDN – Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- web.dev – Storage for the web: https://web.dev/articles/storage-for-the-web
- web.dev – Persistent storage: https://web.dev/articles/persistent-storage
- Chrome blog – IndexedDB durability defaults to relaxed: https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed/
- MDN – IDBTransaction.durability: https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/durability
- Chromium – local_storage_impl.cc (5 s commit delay): https://github.com/chromium/chromium/blob/main/components/services/storage/dom_storage/local_storage_impl.cc
- Chrome – Page Lifecycle API: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- Chrome 139 release notes (Android freeze after one minute): https://developer.chrome.com/release-notes/139
- web.dev – bfcache: https://web.dev/articles/bfcache

**PWA**
- web.dev – install criteria: https://web.dev/articles/install-criteria
- Chrome blog – update to install criteria: https://developer.chrome.com/blog/update-install-criteria
- web.dev – maskable icons: https://web.dev/articles/maskable-icon

**Network and sync**
- WICG – Network Information API: https://wicg.github.io/netinfo/
- MDN – NetworkInformation: https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
- Chrome Help – Lite mode no longer supported: https://support.google.com/chrome/answer/2392284?hl=en
- What's new in DevTools 134 (Save-Data emulation): https://developer.chrome.com/blog/new-in-devtools-134
- Chrome blog – Background Sync: https://developer.chrome.com/blog/background-sync
- Chrome – Periodic Background Sync: https://developer.chrome.com/docs/capabilities/periodic-background-sync
- Chromium – background_sync_parameters.cc: https://github.com/chromium/chromium/blob/4e1b7bc33d42b401d7d9ad1dcba72883add3e2af/content/public/browser/background_sync_parameters.cc

**Throttling and testing**
- DevTools NetworkManager.ts (presets): https://github.com/ChromeDevTools/devtools-frontend/blob/cd4a47576027083f7da8b37e2eebcf3adaf9a011/front_end/core/sdk/NetworkManager.ts
- DevTools CPUThrottlingOption.ts: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/panels/common/CPUThrottlingOption.ts
- DevTools ThrottlingPresets.ts: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/panels/mobile_throttling/ThrottlingPresets.ts
- Chrome – DevTools throttling settings: https://developer.chrome.com/docs/devtools/settings/throttling
- CDP Network.pdl: https://github.com/ChromeDevTools/devtools-protocol/blob/b0d96c6cdf39e5583e67a3762b2815a33154455b/pdl/domains/Network.pdl
- CDP Emulation.pdl: https://github.com/ChromeDevTools/devtools-protocol/blob/b0d96c6cdf39e5583e67a3762b2815a33154455b/pdl/domains/Emulation.pdl
- Playwright – CDPSession: https://playwright.dev/docs/api/class-cdpsession
- Lighthouse – throttling docs: https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md

**Performance and delivery**
- web.dev – Performance budgets 101: https://web.dev/articles/performance-budgets-101
- web.dev – Extract critical CSS (14 KB): https://web.dev/articles/extract-critical-css
- Chrome – Lighthouse critical request chains: https://developer.chrome.com/docs/lighthouse/performance/critical-request-chains
- web.dev – Font best practices: https://web.dev/articles/font-best-practices
- Caddy – encode: https://caddyserver.com/docs/caddyfile/directives/encode
- Caddy – file_server (precompressed): https://caddyserver.com/docs/caddyfile/directives/file_server
