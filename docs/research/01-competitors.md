# 01: Competitive Intelligence: To-Do Apps, Outliners, and Interaction Leaders

**Product:** Lists (lists.remypost.me). Unlimited lists, unlimited nesting, local-first, keyboard-first, smart views (Today/Upcoming), premium feel, must work on slow 3G.
**Date compiled:** 2026-11-05
**Method:** Every claim below links to a source fetched during this research: official docs, help centers, changelogs, and maker blogs/talks first, then award pages and reviews, then real user discussion (Hacker News threads, vendor forums, the MacPowerUsers forum, Microsoft Tech Community, Product Hunt).

**Coverage gaps (read this first):**
- **The Verge and Wirecutter (nytimes.com) block our fetcher.** Nothing in this report is attributed to them except where another source quotes them, and those quotes are labeled.
- **reddit.com is not fetchable.** User complaints come from Hacker News (read through the public Algolia API), vendor forums and MPU instead.
- **Some help centers render client-side,** including TickTick's and parts of Linear's. For those, a few details come from the official page's search-index snippet and are marked *(index snippet)*.

---

## Contents

1. [At-a-glance comparison matrix](#1-at-a-glance-comparison-matrix)
2. [App-by-app profiles](#2-app-by-app-profiles)
   - Things 3 · Todoist · TickTick · OmniFocus · Microsoft To Do (Wunderlist heritage) · Apple Reminders · Workflowy · Dynalist · Logseq · Tana · Superlist · TeuxDeux · Any.do · Google Tasks · todo.txt / Taskwarrior · Linear
3. [Steal list (24 items)](#3-steal-list)
4. [Avoid list](#4-avoid-list)
5. [What wins awards and loyalty](#5-what-wins-awards-and-loyalty)
6. [Recommended keyboard map + macOS Chrome conflicts](#6-recommended-keyboard-shortcut-map)
7. [Sources](#sources)

---

## 1. At-a-glance comparison matrix

| App | Nesting depth (tasks) | Natural-language dates | Undo | Offline | Pricing model | Signature interaction |
|---|---|---|---|---|---|---|
| **Things 3** | Area › Project › Heading › To-do › Checklist item. No sub-projects ([features](https://culturedcode.com/things/features/); [sspai](https://sspai.com/post/39653) *(index snippet)*) | Yes, in When/Deadline fields, 8 languages ([support](https://culturedcode.com/things/support/articles/9780167/)) | ⌘Z on Mac. On iOS, shake to undo the last deletion only; iOS deletions are otherwise permanent ([FAQ](https://culturedcode.com/things/support/articles/2967034/)) | Native apps, full offline. Things Cloud sync | One-time purchase per platform ($49.99 Mac / $19.99 iPad / $9.99 iPhone) ([MacRumors](https://www.macrumors.com/2017/05/18/things-3-task-manager-for-mac-ios-and-apple-watch/)) | Magic Plus drag-to-insert. Today/This Evening |
| **Todoist** | 4 indent levels under a parent ([help](https://www.todoist.com/help/articles/introduction-to-sub-tasks-kMamDo)) | Yes, highlighted inline. Click to un-highlight ([help](https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO)) | ⌘Z. **No undo for delete** ([help](https://www.todoist.com/help/todoist/features/introduction-to-tasks-080OAXric)) | Web offline if already logged in. Unsynced changes lost if local data is cleared ([help](https://www.todoist.com/help/articles/use-todoist-while-offline-4rbaZw)) | Freemium. Pro rose $5→$7/mo on 10 Dec 2025 ([help](https://www.todoist.com/help/todoist/billing/todoist-pro-pricing-update-in-2025-bxBvHZuJZ)) | Quick Add syntax (`#project /section @label p1 !reminder`) |
| **TickTick** | Up to 5 levels including parent ([help](https://help.ticktick.com/articles/7055782219767349248) *(index snippet)*; [blog](https://blog.ticktick.com/2020/08/10/how-task-nesting-helps-you-with-gtd/)) | Yes, "Smart Recognition". Tap highlight to cancel. Optional removal from title ([help](https://help.ticktick.com/articles/7081924556310446080) *(index snippet)*) | n/a found | Native apps | Freemium, ~$3.99/mo ([Zapier](https://zapier.com/blog/best-todo-list-apps/)) | Draggable "+" places the task where you drop it. Pomodoro and habits built in |
| **OmniFocus 4** | Folders › Projects › Action groups (nest) › Actions ([manual](https://support.omnigroup.com/documentation/omnifocus/universal/4.10/en/print/)) | Date fields | ⌘Z (native) | Native. Web needs a subscription ([web manual](https://support.omnigroup.com/documentation/omnifocus/universal/4.9.3/en/web/)) | $74.99 Std / $149.99 Pro, or $99.99/yr ([TidBITS](https://tidbits.com/watchlist/and-omnifocus-4-0-1/) *(index snippet)*) | Perspectives, defer dates, Review |
| **Microsoft To Do** | Task › Steps (one level) ([support](https://support.microsoft.com/en-us/office/add-steps-importance-notes-tags-and-categories-to-your-tasks-bf9fdff6-f85f-4e03-9534-c587eb32515c)) | Limited | n/a found | Native + web | Free | My Day resets nightly ([support](https://support.microsoft.com/en-us/todo/my-day-and-suggestions)) |
| **Apple Reminders** | Subtasks by indent ⌘] ([support](https://support.apple.com/guide/reminders/add-subtasks-to-reminders-remn32a9622b/mac)) | Yes, but MacStories calls it "bad" ([iOS 27 review](https://www.macstories.net/stories/ios-and-ipados-27-review/12/)) | ⌘Z | Native | Free | Smart lists, sections/columns |
| **Workflowy** | Unlimited ("Go as deep as you like") ([get started](https://community.workflowy.com/t/get-started/1650)) | Date tags | ⌘Z / ⌘⇧Z | Offline edits sync later ([blog](https://blog.workflowy.com/workflowy-goes-offline/)) | Freemium, monthly item cap on free tier | Zoom into any bullet. Mirrors |
| **Dynalist** | Unlimited | Dates, Google Calendar sync (Pro) ([help](https://help.dynalist.io/article/134-google-calendar-integration)) | ⌘Z / ⌘Y / ⌘⇧Z ([shortcuts](https://help.dynalist.io/article/91-keyboard-shortcut-reference)) | Desktop app offline ([features](https://dynalist.io/features/full)) | Freemium | Outliner + checklists. Item finder |
| **Logseq** | Unlimited blocks | `/Scheduled`, `/Deadline` + repeaters ([docs](https://github.com/logseq/docs/blob/master/pages/Tasks.md)) | Global undo that **navigates back to the edited page** ([docs](https://github.com/logseq/docs/blob/master/pages/Undo%20and%20Redo.md)) | Local files (local-first) | Free / OSS. Paid sync | `Cmd+Enter` cycles TODO→DOING→DONE |
| **Tana** | Unlimited nodes | Date fields | n/a | Cloud | Paid tiers | Supertags (#task) + live searches ([docs](https://outliner.tana.inc/learn/features/supertags)) |
| **Superlist** | "Subtasks under subtasks infinitely" ([review](https://hyperquest.digitalpress.blog/superlist-the-definitive-review/)) | Not documented | n/a | Sync popups reported ([review](https://hyperquest.digitalpress.blog/superlist-the-definitive-review/)) | Free + Pro $8/user/mo ([TechCrunch](https://techcrunch.com/2024/02/16/superlist/)) | Tasks + rich notes in one surface |
| **TeuxDeux** | Flat | n/a | n/a | Synced iOS/Android | Paid (7-day trial) ([site](https://teuxdeux.com/)) | Week columns. Unfinished items roll over |
| **Any.do** | Subtasks | AI-assisted parsing | n/a | Native | Freemium. Paywall complaints | Plan My Day ("Moment") ([support](https://support.any.do/en/articles/8635857-managing-overdue-personal-tasks)) |
| **Google Tasks** | **One level since 2019** (deeper levels were flattened) ([gtaskd](https://www.gtaskd.com/google-ending-support-for-nested-subtasks/)) | No | ⌘Z ([shortcuts](https://support.google.com/tasks/answer/7675630?hl=en&co=GENIE.Platform%3DDesktop)) | n/a | Free | Lives in the Gmail/Calendar sidebar |
| **todo.txt / Taskwarrior** | Flat (todo.txt). Dependencies (TW) | TW named dates (`eow`, `eom`, `someday`) ([docs](https://taskwarrior.org/docs/named_dates/)) | `task undo`, but synced changes can't be undone ([man](https://taskwarrior.org/docs/man/task-sync.5/)) | Fully local | Free / OSS | Plain-text format. Computed urgency |
| **Linear** (issue tracker) | Sub-issues | n/a | Undo/redo built into the sync engine ([summary](https://second-brain-nuxt.vercel.app/unexpected-benefits-of-going-local-first) *(secondary)*) | Local replica in IndexedDB | SaaS | ⌘K command menu. Single-key actions. Speed budget of "a few hundred ms" |

---

## 2. App-by-app profiles

### Things 3 (Cultured Code): Mac, iPad, iPhone, Watch, Vision

**Known for:** calm, opinionated design and two Apple Design Awards (2009 and 2017) ([Cultured Code blog](https://culturedcode.com/things/blog/2017/06/back-from-wwdc/); [Wikipedia](https://en.wikipedia.org/wiki/Things_(software))).

**Signature interactions**
- **Magic Plus button.** Tap it to add a task. Drag it to insert a to-do at an exact spot, to create a heading, or to drop a task into the Inbox ([features](https://culturedcode.com/things/features/)). MacStories called it "one of the most clever methods of task entry I've seen." Dropping it on a day in Upcoming sets that day as the start date ([MacStories review](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)).
- **Today + This Evening.** Today holds "to-dos that you want to start before the day ends." This Evening is a section at the bottom of the same list ([support](https://culturedcode.com/things/support/articles/4001304/)).
- **Start date ("When") vs Deadline.** A start date controls when an item becomes active. A deadline does not hide the item, and it pulls the item into Today on the day it falls due. "Once their start date arrives, the inactive to-dos from Upcoming transform into actionable items in Today" ([support](https://culturedcode.com/things/support/articles/4001304/)).
- **Upcoming.** Lists the next 7 days individually, then groups further out by week and month ([MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)). Shows calendar events, repeating items and deadlines, and you reschedule by drag and drop ([features](https://culturedcode.com/things/features/)).
- **Headings inside projects.** Dragging a heading moves all its to-dos, and archiving a heading archives them ([features](https://culturedcode.com/things/features/)). Viticci called headings a feature he'd "never seen in any other task manager" ([MacStories](https://www.macstories.net/stories/things-automation/)).
- **Checklists.** Lightweight sub-steps inside a to-do. Pasting a bulleted list converts it into a checklist ([features](https://culturedcode.com/things/features/)).
- **Quick Find / Type Travel.** On Mac you just start typing anywhere to jump to a list, tag or to-do. No shortcut is needed ([features](https://culturedcode.com/things/features/); [shortcuts](https://culturedcode.com/things/support/articles/2785159/)).
- **Paste to create.** ⌘V makes one to-do per line of clipboard text. Space creates a new to-do below the selection ([shortcuts](https://culturedcode.com/things/support/articles/2785159/)).
- **Keyboard date nudges.** ^] / ^[ move the start date ±1 day, ^⇧] / ^⇧[ ±1 week, ^. / ^, the deadline ±1 day ([shortcuts](https://culturedcode.com/things/support/articles/2785159/)).
- **Logbook.** Completed items are archived. ⇧⌘Y moves completed items to the Logbook manually, and a setting chooses Immediately, Daily or Manual logging ([shortcuts](https://culturedcode.com/things/support/articles/2785159/); [release notes](https://culturedcode.com/things/support/articles/2409121/) *(index snippet)*). Under Daily or Manual, checked items stay visible in place, so the satisfaction lingers and you can undo by eye.
- **Natural language dates.** Phrases like "in 5 weeks" or "15 Tage" parse according to device locale ([3.1 blog](http://culturedcode.com/things/blog/2017/07/things-3-1-repeating-to-dos-date-parsing/)). Eight languages are supported. Deadlines take natural language only on Mac, or on iPad with a hardware keyboard ([support](https://culturedcode.com/things/support/articles/9780167/)).
- **Repeating.** Two modes: a fixed schedule, or "after completion." Each repeating item has a template. "Add deadlines" with "days earlier" makes an item appear N days before its deadline ([support](https://culturedcode.com/things/support/articles/2803564/)).
- **Undo.** ⌘Z on Mac. On iPhone you shake to recover the last deletion. Otherwise "deletions on iPhone, iPad, and Vision are permanent," and only the Mac has a Trash ([FAQ](https://culturedcode.com/things/support/articles/2967034/) *(index snippet)*).
- **Sync.** Things Cloud was designed "fourteen years ago… on a solid mathematical foundation." It was rebuilt in Swift with "a fourfold speed boost," running in parallel with the old system before the switch ([blog](https://culturedcode.com/things/blog/2025/05/a-swift-cloud/)). The Fractus text-sync engine sends only the changed text ([Wikipedia](https://en.wikipedia.org/wiki/Things_(software))).

**What people love**
- **"Opinionated."** "Just follow the way the app does task management and you can just get on with work" ([MPU forum](https://talk.macpowerusers.com/t/what-do-you-love-about-things-3/27387)).
- **Calm.** Overdue tasks don't turn red. The Today/This Evening split is "absolutely in line with how I think about my typical day," and the app "doesn't stress me out" ([MacStories, Viticci](https://www.macstories.net/stories/things-automation/)).
- **Pricing and focus.** Users praise the one-time purchase and the defer (start) dates ([MPU forum](https://talk.macpowerusers.com/t/what-do-you-love-about-things-3/27387)).
- **Design.** Zapier's design pick: it is "somehow both" complex and minimalist ([Zapier](https://zapier.com/blog/best-todo-list-apps/)).

**Complaints / why people leave**
- **Apple-only.** No web, Windows or Android ([Zapier](https://zapier.com/blog/best-todo-list-apps/)).
- **Pays per platform.** Each platform is bought separately ([MPU](https://talk.macpowerusers.com/t/what-do-you-love-about-things-3/27387); [HN](https://news.ycombinator.com/item?id=39758633)).
- **Slow development.** "Cultured Code's rate of development is my greatest negative" ([HN](https://news.ycombinator.com/item?id=39758806)).
- **Gaps.** No attachments or images ([HN](https://news.ycombinator.com/item?id=39758765)). No sub-projects ([sspai](https://sspai.com/post/39653) *(index snippet)*). Weak "nagging" reminders ([MPU](https://talk.macpowerusers.com/t/what-do-you-love-about-things-3/27387)).
- **Early-version gaps.** MacStories listed no web API, no native attachments, and repeating tasks unavailable inside projects (fixed in 3.1) ([MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/); [3.1 blog](http://culturedcode.com/things/blog/2017/07/things-3-1-repeating-to-dos-date-parsing/)).

**How it differs:** It is the only major app that treats start date and deadline as separate first-class concepts and builds its whole navigation (Today, Upcoming, Anytime, Someday) around them. The trade-off is that structure is deliberately shallow.

---

### Todoist (Doist): every platform + web

**Known for:** the best natural-language Quick Add on the market and ubiquity. Zapier's overall pick "balances power with simplicity" ([Zapier](https://zapier.com/blog/best-todo-list-apps/)). Todoist's store copy quotes The Verge calling it "the best to-do list app right now" (quoted via Todoist, not verified at the Verge) ([Wayback of todoist.com](https://webcf.waybackmachine.org/web/20211022050253/https://todoist.com)).

**Signature interactions**
- **Quick Add inline syntax.** `#` project, `/` section, `+` assignee, `@`/`%` label, `!` reminder, `p1–p4` priority, `{date}` deadline ([shortcuts](https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2)).
- **Date highlighting.** Dates are highlighted as you type. Clicking the highlight un-highlights it, so "Create monthly report" stays literal ([help](https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO)).
- **Recurring grammar.** `every` vs `every!` decides whether the next date counts from the schedule or from completion. Also supported: `every other fri`, `every mon, fri at 20:00`, `everyday for 3 weeks`, `from 10 May until 20 May` ([help](https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV)).
- **Single-key, Gmail-style shortcuts:**
  - Create: `q` quick add, `a` / `A` add task at bottom / top.
  - Act on a task: `e` complete, `t` set date, `Shift+T` remove date, `1–4` priority, `v` move, `x` select.
  - Navigate: `j/k` move focus, `g` then `t/u/i` go to Today / Upcoming / Inbox.
  - Help: `?`.
  - Nesting: indent with **Control+]** on macOS (not ⌘]) ([shortcuts](https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2)).
- **Enter chaining.** Enter saves the task and opens a new one below. Shift+Enter saves and creates below. Ctrl+Enter creates above ([shortcuts](https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2)).
- **Completion feedback.**
  - An optional "task complete tone" can be enabled separately for desktop/web and for mobile ([help](https://www.todoist.com/help/todoist/features/introduction-to-tasks-080OAXric)).
  - **Karma** and goals: default daily goal 5 tasks, weekly 25. Streaks are protected by vacation mode and days off ([Karma help](https://www.todoist.com/help/todoist/features/introduction-to-karma-OgWkWy); [Productivity view](https://www.todoist.com/help/todoist/features/use-the-productivity-view-in-todoist-6S63uAa9) *(index snippet)*).
- **Subtasks.** Four indent levels. In smart views (Today, Upcoming, filters) subtasks start collapsed behind a count. Un-completing a subtask also un-completes its parent ([subtasks](https://www.todoist.com/help/articles/introduction-to-sub-tasks-kMamDo); [tasks](https://www.todoist.com/help/todoist/features/introduction-to-tasks-080OAXric)).

**Complaints / why people leave**
- **Deletion is irreversible.** "There's no option to undo task deletion." Recovery means restoring a CSV backup ([help](https://www.todoist.com/help/todoist/features/introduction-to-tasks-080OAXric)).
- **Fragile web offline.**
  - You must be logged in before you lose connection.
  - "Don't close Todoist, shut down your computer, log out, or clear local data" before sync finishes, or offline changes are deleted ([help](https://www.todoist.com/help/articles/use-todoist-while-offline-4rbaZw)).
  - A July 2026 changelog fixed offline changes "temporarily vanishing" when opening a new window ([changelog](https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd) *(index snippet)*).
- **Price hike.** Monthly Pro went $5 → $7 (+40%) in December 2025, while App Store subscribers were held on a legacy price ([help](https://www.todoist.com/help/todoist/billing/todoist-pro-pricing-update-in-2025-bxBvHZuJZ)).
- **Feel and speed.** It "feels like a web app" ([Zapier](https://zapier.com/blog/best-todo-list-apps/)). "I used to have Todoist but the slugginess killed it for me" ([HN](https://news.ycombinator.com/item?id=39758661)).
- **Depth cap.** Nesting stops at 4 levels ([help](https://www.todoist.com/help/articles/introduction-to-sub-tasks-kMamDo)).

---

### TickTick: every platform + web

**Known for:** being the "everything" app. Tasks, calendar with time-blocking, Pomodoro, habits and an Eisenhower matrix in one. Free tier "impressively full-featured" ([Zapier](https://zapier.com/blog/best-todo-list-apps/)).

**Signature interactions**
- **Draggable "+" (mobile).** Hold "+" and drag it into the list to place the new task there. Dropping it under a subtask creates a subtask ([TickTick blog](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/)). This is the same idea as Things' Magic Plus.
- **Smart Recognition.**
  - Dates and times are recognized as you type or dictate.
  - Tapping the blue highlight returns it to plain text.
  - An option strips the date text out of the title ([blog](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/); [help](https://help.ticktick.com/articles/7081924556310446080) *(index snippet)*).
- **Plan Your Day.** A button in Today walks you through overdue and today's tasks one by one, so you can reschedule, complete or delete each ([blog](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/)).
- **Repeat Type.** The next occurrence counts from the completion date or the due date ([blog](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/)).
- **Nesting.** "Up to 5 layers including the parent task" ([TickTick blog](https://blog.ticktick.com/2020/08/10/how-task-nesting-helps-you-with-gtd/); [help](https://help.ticktick.com/articles/7055782219767349248) *(index snippet)*).
- **Shortcuts.**
  - `?` shows the shortcut list. Ctrl/⌘+K opens a command menu. Shortcuts are customizable ([help](https://help.ticktick.com/articles/7055780449171275776) *(index snippet)*).
  - Global add is Shift+Alt+A on Windows ([help](https://help.ticktick.com/articles/7055782422935240704) *(index snippet)*). The Mac page lists ⌘⇧A for the same thing ([Mac page](https://ticktick.com/mac?language=en_us) *(index snippet)*).

**Complaints:**
- **Clutter.** "The desktop app can occasionally feel a bit cluttered because it packs so many features into the interface" ([Capterra](https://www.capterra.com/p/170641/TickTick/reviews) *(index snippet)*).
- **Polish.** "Not always quite as polished as Todoist" ([Zapier](https://zapier.com/blog/best-todo-list-apps/)). "Slightly less refined," though it has a "faster developmental pace" ([HN](https://news.ycombinator.com/item?id=39763342)).

---

### OmniFocus 4 (Omni Group): Apple platforms + web (subscription)

**Known for:** GTD power-user depth.
- **Custom Perspectives** (saved filter/group views, Pro).
- **Defer dates.**
- **Forecast,** which combines actions and calendar events.
- **Review,** which periodically walks you through every project.
- **Sequential vs parallel projects and action groups** ([features](https://www.omnigroup.com/omnifocus/features); [manual](https://support.omnigroup.com/documentation/omnifocus/universal/4.10/en/print/)).

**Nesting:** Folders hold folders. Action groups hold action groups. Hierarchy is represented as outline indentation ([manual](https://support.omnigroup.com/documentation/omnifocus/universal/4.10/en/print/)).

**Notable interactions**
- **Bare-key field editing on a selected row.** Space toggles complete, `D` due, `Shift-D` defer, `R` repeat, `T` tags, `P` project, `F` flag ([commands](https://support.omnigroup.com/documentation/omnifocus/universal/4.3.3/en/commands-and-shortcuts/)).
- **Add Inside / Add Outside.** ⇧⌘} creates a child, ⇧⌘{ a sibling of the parent ([commands](https://support.omnigroup.com/documentation/omnifocus/universal/4.3.3/en/commands-and-shortcuts/)).
- **Deferred "Clean Up".** A completed item "may not immediately disappear from the Outline." It stays until you navigate away or run Clean Up ([manual](https://support.omnigroup.com/documentation/omnifocus/universal/4.10/en/print/)).

**Complaints**
- **Steep learning curve.** Things is "more intuitive and less intimidating than Omni Group's task manager" ([MacStories](https://www.macstories.net/stories/things-automation/)).
- **Version 4 regressions.** One user found it "uses 1/3 more RAM, is noticeably slower… has no new functionality" ([MPU](https://talk.macpowerusers.com/t/omnifocus-4-release/35717?page=3) *(index snippet)*).
- **No completion sound.** Users ask for one: "This would be so great. And so easy to add" ([Omni forum](https://discourse.omnigroup.com/t/is-there-a-task-completion-sound/70299)).
- **Web is a second-class client.** It requires a subscription, and Review, notifications and repeat editing are not supported there ([web manual](https://support.omnigroup.com/documentation/omnifocus/universal/4.9.3/en/web/) *(index snippet)*).
- **Keyboard support is disputed.** One HN user calls it "frustrated by the lack of keyboard support," another says it is "fine… well thought out" ([HN](https://news.ycombinator.com/item?id=39758773); [HN](https://news.ycombinator.com/item?id=39760187)).

---

### Microsoft To Do (Wunderlist heritage)

**History.** Microsoft bought Wunderlist, then announced its shutdown for 6 May 2020 ([TechCrunch](https://techcrunch.com/2019/12/09/microsoft-to-finally-shut-down-to-do-list-app-wunderlist-on-may-6-2020); [Wikipedia](https://en.wikipedia.org/wiki/Wunderlist)). Founder Christian Reber publicly offered to buy it back ([Wikipedia](https://en.wikipedia.org/wiki/Wunderlist)). Long-time users said To Do implemented "only… a subset of the Wunderlist features… sub tasks and nested lists/projects are not there" ([HN](https://news.ycombinator.com/item?id=14155842)). They also missed Wunderlist as the to-do app "the whole family could use," with easy sharing and custom backgrounds ([HN](https://news.ycombinator.com/item?id=14154841)).

**Signature interactions**
- **My Day.** A daily list that "resets every night." Unfinished items return to Tasks and resurface as suggestions the next day ([support](https://support.microsoft.com/en-us/todo/my-day-and-suggestions)). It is a deliberate fresh-start ritual.
- **Steps.** One level of sub-steps ([support](https://support.microsoft.com/en-us/office/add-steps-importance-notes-tags-and-categories-to-your-tasks-bf9fdff6-f85f-4e03-9534-c587eb32515c)).
- **Shortcuts.** Ctrl+N new task, Ctrl+T add to My Day, Ctrl+D complete, Ctrl+R sync ([support](https://support.microsoft.com/en-us/todo/using-keyboard-shortcuts-in-microsoft-to-do)).
- **Look.** Per-list background images. Zapier calls it "one of the prettiest" ([Zapier](https://zapier.com/blog/best-todo-list-apps/)).

**Complaints**
- **Steps are second-class.** Users have asked for years for due dates on steps ([Tech Community](https://techcommunity.microsoft.com/discussions/to-do/feature-request---due-dates-for-sub-tasks-in-microsoft-to-do/2538142)) and for "1 extra layer of sub-tasks to sub-tasks" ([Tech Community](https://techcommunity.microsoft.com/discussions/to-do/request-for-option-to-add-1-extra-layer-of-sub-tasks-to-sub-tasks/3640196)).

---

### Apple Reminders

**Known for:** free, system-integrated, and "continues to improve every year." Zapier notes it is "still not great for managing lots of to-dos and projects" ([Zapier](https://zapier.com/blog/best-todo-list-apps/)).

**Interactions**
- **Subtasks.** Indent with ⌘] and outdent with ⌘[. Completing, deleting or moving a parent applies to its subtasks ([support](https://support.apple.com/guide/reminders/add-subtasks-to-reminders-remn32a9622b/mac)).
- **Date shortcuts.**
  - ⌘T due today, ⌥⌘T tomorrow, ⌘K this weekend, ⌥⌘K next week.
  - **^⌘T sets all overdue reminders to today.** This is a one-key "rescue overdue" ([shortcuts](https://support.apple.com/guide/reminders/keyboard-shortcuts-remn19b3424c/mac)).
- **Show subtasks.** ⌘E shows all subtasks, ⇧⌘E hides them ([shortcuts](https://support.apple.com/guide/reminders/keyboard-shortcuts-remn19b3424c/mac)).
- **Sections and columns.** Lists split into sections, and "View as Columns" turns them into a board (iOS 17) ([MacStories](https://www.macstories.net/stories/ios-and-ipados-17-the-macstories-review/10/)). Subtasks appear in smart lists from iOS 18 ([MacStories](https://www.macstories.net/stories/ios-and-ipados-18-the-macstories-review/10/)).

**Complaints**
- **Weak natural language.** NL creation is "just as bad" as Calendar's, and "there is still no shortcut to quickly change the list a reminder belongs to" ([MacStories iOS 27](https://www.macstories.net/stories/ios-and-ipados-27-review/12/)). Date parsing sometimes got dates badly wrong ([MacStories iOS 17](https://www.macstories.net/stories/ios-and-ipados-17-the-macstories-review/10/)).
- **Tab doesn't indent on Mac** ([9to5Mac](https://9to5mac.com/2019/10/16/make-subtasks-reminders-iphone-ipad-mac/) *(index snippet)*).

---

### Workflowy: the canonical infinite outliner

**Known for:** "Workflowy is a single, infinite document." Enter adds an item. Tab nests: "Go as deep as you like." Clicking a bullet **zooms** into it so it becomes "your whole world," with breadcrumbs to zoom out. Typing filters in real time, and searches can be starred to the sidebar ([get started](https://community.workflowy.com/t/get-started/1650)).

**Mirrors.** "The same bullet in multiple places." Create one with ⌘⇧M or `((` ([help](https://workflowy.com/help/mirrors/) *(index snippet)*; [blog](https://blog.workflowy.com/mirrors-create-live-copies-of-any-bullet/)).

**Shortcuts (macOS)** ([shortcuts](https://community.workflowy.com/t/keyboard-shortcuts/1686))
- **Structure:** Tab / ⇧Tab indent and outdent. ⌘⇧↑/↓ move.
- **Outline:** ⌘↑/↓ collapse and expand. ⌘. / ⌘, zoom in and out. ⌘Enter complete. ⇧Enter note. ⌘O show completed.
- **Navigate:** ⌘K jump to any item. ⌘' go home.
- **Commands and help:** ⌥W command palette. ⌘/ shortcut panel.

**Failure lesson.** Expand-all on large trees "could make the app unusable and sometimes locked users out of their accounts." It was also triggered by accidental double-clicks while selecting text, so Workflowy removed it ([blog](https://blog.workflowy.com/why-we-disabled-expand-all-by-double-clicking-on-the-page-title-and-logo/)). **Unlimited nesting needs virtualization and lazy expansion.**

**Offline.** "Any changes you make while offline will be remembered and synced when you come back online" (2013 iOS) ([blog](https://blog.workflowy.com/workflowy-goes-offline/)). A user reported offline edits overwriting desktop edits on sync, a last-writer-wins conflict ([blog comments](https://blog.workflowy.com/an-offline-desktop-app-for-workflowy/comment-page-1/) *(index snippet)*).

**Complaints.** The free tier has a monthly item cap, and its size has changed several times (100/250/500 reported) ([pricing](https://beta.workflowy.com/pricing) *(index snippet)*). An HN user notes it is "not completely free" ([HN](https://news.ycombinator.com/item?id=39761740)), while another replies that "all of the important stuff is free" ([HN](https://news.ycombinator.com/item?id=39770808)).

---

### Dynalist (makers of Obsidian)

**Known for:** Workflowy-style unlimited outlining plus more power.
- **Checklists** that toggle per list.
- **Dates** with overdue highlighting in red, and one-way Google Calendar sync (Pro, about every minute).
- **Navigation:** item finder, file finder and an item mover.
- **Safety and editing:** version history, daily backups to Dropbox or Google Drive, and customizable shortcuts.

Sources: [features](https://dynalist.io/features/full); [GCal help](https://help.dynalist.io/article/134-google-calendar-integration).

**Shortcuts** ([reference](https://help.dynalist.io/article/91-keyboard-shortcut-reference))
- **Outline:** Tab / ⇧Tab indent and outdent. ⌘. expand or collapse, ⌘⇧. all.
- **Items:** ⌘Enter mark done. ⇧Enter switch to the note.
- **Zoom:** **⌘] / ⌘[ zoom in / out.** These are Chrome's Forward/Back, so Dynalist offers Alt+→/← as a German-layout alternative.
- **Move and select:** ⌘↑/↓ swap with sibling. ⇧↑/↓ extend selection.
- **Find:** ⌘O file finder, ⌘⇧O item finder.

**Loyalty and risk.** Users call it "pretty much perfect" and "the best outliner I've tried," yet beg for any sign of life: "maintenance mode" rather than abandoned ([forum](https://talk.dynalist.io/t/dynalist-love-letter-and-request-for-maintenance-mode/10048)). There has been no development update since 2021 ([forum](https://talk.dynalist.io/t/what-is-the-current-state-of-the-developement-of-dynalist/8472) *(index snippet)*). **Lesson:** outliner users are intensely loyal, but they fear lock-in. Export and data ownership are a selling point.

---

### Logseq (and outliner ideas)

**Task model** ([docs](https://github.com/logseq/docs/blob/master/pages/Tasks.md))
- Any block becomes a task with a marker: `LATER→NOW→DONE` or `TODO→DOING→DONE`.
- **`Cmd+Enter` cycles the marker.** Also available: `/A /B /C` priorities and `/Scheduled` / `/Deadline` dates.
- **Repeaters** are `.+1d` (from completion), `++` (keep the weekday) and `+` (from the original date).
- Clicking the checkbox to DONE is "rather satisfying to do."

**Undo** ([docs](https://github.com/logseq/docs/blob/master/pages/Undo%20and%20Redo.md))
- Undo is global by default and **navigates you to the page where the change happened.**
- It restores the cursor and sidebar state, and history is unlimited.

**Shortcuts.** Sequential "key combos" when the editor isn't focused: `g` = go, `t` = toggle, `n` = new, `c` = close. Everything is remappable, because "Customizable keyboard shortcuts is the only way to make everybody happy" ([docs](https://github.com/logseq/docs/blob/master/pages/Keyboard%20shortcuts.md)).

**Complaints**
- **Buggy and slow, stalled for years.** "Remained a buggy mess… after several years of complete stagnation" ([HN](https://news.ycombinator.com/item?id=48896645)). "The interface was slow and buggy" ([HN](https://news.ycombinator.com/item?id=48898981)).
- **Paid sync that didn't arrive.** "I paid to support the sync effort but we saw nothing for years" ([HN](https://news.ycombinator.com/item?id=48896838)).
- **File sync conflicts.** "Syncing text files… will break given enough complexity and multi-device usage, especially… a daily note on multiple locations at the same time" ([HN](https://news.ycombinator.com/item?id=48897286)).
- **Sync pricing.** "$15/mo for logseq is equally nutty" ([HN](https://news.ycombinator.com/item?id=33219781)).

### Tana

- **Supertags.** A supertag "turn[s] a node into a typed object with a template of fields." All nodes with the same supertag form a searchable collection ([docs](https://outliner.tana.inc/learn/features/supertags)).
- **Tasks as a live search.** Tag a node `#task`, give it a Status field, then place a live search for "#task NOT DONE" on a daily note. Searches are built from ⌘K → Find nodes ([docs](https://outliner.tana.inc/articles/simple-task-management) *(index snippet)*).
- **Idea for Lists:** smart views (Today, Upcoming) are really saved queries over a tree, and they can be embedded anywhere.

---

### Superlist (Wunderlist founders)

- **Founders and pitch.** Christian Reber (Wunderlist) and Niklas Jansen (Blinkist). A personal-first, then team, "Trojan horse." Tasks carry long notes, images and attachments. Pro is $8/user/month ([TechCrunch](https://techcrunch.com/2024/02/16/superlist/)).
- **Praise.** The design is "exceptionally well-crafted," and you can "create subtasks under subtasks infinitely."
- **Criticism.**
  - Keyboard basics break: "tab movement for cursor, multi-selecting tasks with shift don't work as expected."
  - Sync instability: "the Mac app going offline and displaying a popup about syncing problems" happens often ([review](https://hyperquest.digitalpress.blog/superlist-the-definitive-review/)).
  - Subtasks don't reset on repeating tasks ([Product Hunt](https://www.producthunt.com/p/superlist/superlist-3) *(index snippet)*).

**Lesson:** infinite nesting plus beauty is not enough if Tab and Shift-select don't behave like a real outliner and sync errors surface as modal popups.

### TeuxDeux

- **Rollover.** "Unfinished to-dos roll over so you can tackle them tomorrow."
- **Someday lists** sit "under your day-to-day tasks so they're always in focus."
- **Philosophy.** "Your to-do list should never take you out of your workflow" ([site](https://teuxdeux.com/)).
- **Origin.** Creator Tina Roth Eisenberg wanted a weekly view with check-off items and "couldn't find it anywhere." Her stated design aim: "TeuxDeux is as minimal as it gets, and we like it like that" ([swiss-miss](https://www.swiss-miss.com/teuxdeux)).
- **Lesson:** automatic rollover removes the guilt of overdue badges. Compare Things' "no red."

### Any.do

- **Launch gestures (2011).** "Swipe to complete tasks," "Shake to clear completed tasks," drag and drop ([Android Police](https://www.androidpolice.com/2011/11/10/new-app-any-do-from-the-creators-of-taskos-is-the-cleanest-task-list-app-for-android-yet-with-emphasis-on-sharing-and-simplicity/)).
- **Plan My Day ("Moment").** Walks you through overdue tasks one at a time, with options Tomorrow / In 2 Days / Next Week / Someday. It is mobile-only ([support](https://support.any.do/en/articles/8635857-managing-overdue-personal-tasks)).
- **Desktop.** It "feels cluttered" and is "more than a little confusing" ([Zapier](https://zapier.com/blog/best-todo-list-apps/)).
- **Monetization complaints.** Location reminders and advanced recurrence are paywalled ([Capterra](https://www.capterra.com/p/173614/Any-do/reviews) *(index snippet)*). TechRadar: the paywall achieves the same push as nagging ([TechRadar](https://www.techradar.com/reviews/anydo-calendar-app) *(index snippet)*).

### Google Tasks

- **Strengths.** Lives in the Gmail and Calendar sidebars. Zapier calls it "fairly barebones" ([Zapier](https://zapier.com/blog/best-todo-list-apps/)).
- **Shortcuts.** Enter new task, Space complete, ⌘] / ⌘[ indent and outdent, ⌘↑/↓ move, ⌘⇧↑/↓ move to top or bottom, `.` more actions, ⌘Z undo ([shortcuts](https://support.google.com/tasks/answer/7675630?hl=en&co=GENIE.Platform%3DDesktop)). These show that a web app *can* intercept ⌘[ and ⌘] in Chrome.
- **Cautionary tale.** In August 2019 Google ended nested subtasks. "All your deeply-nested subtasks should become second level tasks" ([gtaskd](https://www.gtaskd.com/google-ending-support-for-nested-subtasks/)).
- **Other limit.** "Tasks with subtasks can't repeat" ([help](https://support.google.com/a/users/answer/9310236?hl=en)).

### todo.txt and Taskwarrior (plain-text and CLI)

**todo.txt**
- "A single line in your todo.txt text file represents a single task."
- `(A)` priority, `x` + date for done, `+project`, `@context`, `key:value` extensions.
- Lowercase `x` is chosen so completed tasks sort to the bottom ([spec](https://github.com/todotxt/todo.txt)).
- **Lesson:** a durable, greppable export format is a trust signal.

**Taskwarrior**
- **Urgency score.** A computed, weighted urgency: `+next` 15, due 12, blocking 8, priority H 6, blocked −5, waiting −3 ([urgency](https://taskwarrior.org/docs/urgency/)).
- **Named dates.** `eod`, `eow`, `eom`, `sonw`, `someday` (the year 9999) ([named dates](https://taskwarrior.org/docs/named_dates/)).
- **Recurrence.** Recurring tasks are a hidden template plus generated instances ([recurrence](https://taskwarrior.org/docs/recurrence/)).
- **Undo.** `task undo` "reverts the most recent action" ([man](https://taskwarrior.org/docs/man/task.1/) *(index snippet)*). However, "once changes have been synchronized, they cannot be undone" ([task-sync](https://taskwarrior.org/docs/man/task-sync.5/) *(index snippet)*). This is a local-first undo pitfall Lists must design around.

### Linear (interaction-quality benchmark)

- **Speed is a budget.** "If something takes more than a few hundred milliseconds, we try to make it faster" ([Linear](https://linear.app/now/how-we-built-triage-intelligence) *(index snippet)*).
- **Startup work.**
  - Lazy-load rarely used code and data.
  - Target modern browsers only.
  - Ship "around 50% less code (30% when compressed)."
  - Result: 40–82% faster startup and 70–80% less memory ([changelog](https://linear.app/changelog/2021-03-31-startup-performance-improvements)).
- **Keyboard-first from day one.** The first ticket was the command menu ([localfirst.fm #15](https://www.localfirst.fm/15/transcript)).
- **The menu teaches shortcuts.** Contextual menus show each action's shortcut, so they double as a learning tool ([Invisible details](https://linear.app/now/invisible-details)).
- **Keys.**
  - Act: `C` create, `X` select, ⇧↑/↓ extend selection, ⌘A select all, Esc clear, ⌘K act on the selection ([select issues](https://linear.app/docs/select-issues)).
  - Navigate: `G` then `A`/`X` ([team pages](https://linear.app/docs/default-team-pages) *(index snippet)*), `/` search ([search](https://linear.app/docs/search) *(index snippet)*).
- **Safe-triangle submenus.** "Draw a triangle between the mouse cursor and the sub-menu to create a safe space," so diagonal mouse paths don't close the submenu ([Invisible details](https://linear.app/now/invisible-details)).
- **Local-first architecture.** The aim was "an application with web technologies that feels like a native application," built on a sync engine so "you're effectively just building the front end" ([transcript](https://www.localfirst.fm/15/transcript); [Scaling the sync engine](https://linear.app/now/scaling-the-linear-sync-engine); [talk](https://www.youtube.com/watch?v=VLgmjzERT08)).
  - Secondary write-ups describe a full local replica in IndexedDB, last-writer-wins for most fields, and undo/redo handled by the sync engine ([summary](https://second-brain-nuxt.vercel.app/unexpected-benefits-of-going-local-first) *(secondary)*).
- **Quality over MVP.** "Build a product that would just feel so good that you wouldn't want to use anything else" ([transcript](https://www.localfirst.fm/15/transcript)).

---

## 3. Steal list

Each item gives the source app, the mechanic, and why it works.

1. **Unlimited Tab / Shift-Tab nesting, with zoom-into-any-item and breadcrumbs.** (Workflowy, Dynalist)
   - The mechanic is a single infinite tree. Clicking a bullet or pressing ⌘. makes that item "your whole world" ([Workflowy](https://community.workflowy.com/t/get-started/1650); [Dynalist](https://help.dynalist.io/article/91-keyboard-shortcut-reference)).
   - It works because there are no list-vs-task-vs-subtask categories to learn. A list *is* a task with children, which is exactly Lists' "sub-lists inside sub-lists" promise.
   - **Make zoom a URL route**, so browser Back means zoom out. This is why Dynalist bound zoom-out to Chrome's Back key.

2. **Quick Add with an inline grammar and visible highlights you can click to cancel.** (Todoist, TickTick)
   - Syntax like `#list`, `@tag`, `p1` and dates is highlighted live. Clicking the highlight makes it literal text ([Todoist](https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO); [TickTick](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/)).
   - Fast capture is Zapier's first criterion ([Zapier](https://zapier.com/blog/best-todo-list-apps/)). The highlight fixes the "monthly report" false positive.

3. **Natural-language dates with prefix completion and locale awareness.** (Things)
   - "Tom" becomes tomorrow, "Au" becomes August 1 ([features](https://culturedcode.com/things/features/)). Parsing respects device locale ([3.1](http://culturedcode.com/things/blog/2017/07/things-3-1-repeating-to-dos-date-parsing/)).
   - Everything is two or three keystrokes. Add Taskwarrior's power synonyms (`eow`, `eom`, `someday`) for keyboard users ([TW](https://taskwarrior.org/docs/named_dates/)).

4. **Separate "start / do" date from "deadline".** (Things; Todoist added Deadlines on Pro)
   - A start date hides the item until it is relevant. A deadline keeps it visible and pulls it into Today on the day ([Things](https://culturedcode.com/things/support/articles/4001304/); [Todoist](https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO)).
   - This is the backbone of a trustworthy Today/Upcoming. The MacStories reviewer singled it out ([MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)).

5. **Today with a "This Evening" (later-today) section.** (Things)
   - Two horizons in one view ([support](https://culturedcode.com/things/support/articles/4001304/)).
   - It is "absolutely in line with how I think about my typical day" ([Viticci](https://www.macstories.net/stories/things-automation/)).

6. **Upcoming: 7 individual days, then weeks and months, with drag-to-reschedule.** (Things)
   - See the [MacStories review](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/) and the [features page](https://culturedcode.com/things/features/).
   - Near-term detail and long-term compression on one scroll.

7. **Calm overdue handling: no red guilt, plus an explicit one-step rescue.** (Things, TeuxDeux, Apple Reminders, TickTick, Any.do)
   - Things doesn't turn overdue items red ([Viticci](https://www.macstories.net/stories/things-automation/)). TeuxDeux rolls unfinished items over ([TeuxDeux](https://teuxdeux.com/)).
   - Reminders' ^⌘T "set all overdue reminders due today" ([Apple](https://support.apple.com/guide/reminders/keyboard-shortcuts-remn19b3424c/mac)).
   - TickTick's and Any.do's Plan Your Day walk through overdue items one by one ([TickTick](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/); [Any.do](https://support.any.do/en/articles/8635857-managing-overdue-personal-tasks)).
   - Reducing anxiety is the loyalty driver reviewers name most often (see §5).

8. **Drag-to-place "+" button.** (Things Magic Plus, TickTick)
   - Drag the add button to the exact position, or onto a heading or a day ([Things](https://culturedcode.com/things/features/); [TickTick](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/)).
   - It is the pointer and touch equivalent of "insert here." MacStories called it "delight" in task creation.

9. **Paste multi-line text and get multiple items, with indentation preserved as nesting.** (Things, Godspeed)
   - Things: "one to-do per row of text" ([Things](https://culturedcode.com/things/support/articles/2785159/)). Godspeed "will respect indentation and strip off the bullet characters" ([HN](https://news.ycombinator.com/item?id=39761940)).
   - Zero-cost import from notes, email and other apps. With unlimited nesting it is a superpower.

10. **Enter chains new siblings. Tab nests while typing. Shift+Enter adds a note.** (Todoist, Workflowy, Dynalist)
    - See the shortcut pages for [Todoist](https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2), [Workflowy](https://community.workflowy.com/t/keyboard-shortcuts/1686) and [Dynalist](https://help.dynalist.io/article/91-keyboard-shortcut-reference).
    - Capture never leaves the keyboard. Superlist was faulted when Tab and Shift-select misbehaved ([review](https://hyperquest.digitalpress.blog/superlist-the-definitive-review/)).

11. **⌘K command palette that shows each command's shortcut.** (Linear, Todoist, Workflowy, TickTick, Tana)
    - Linear's menus double as a shortcut-learning tool ([Linear](https://linear.app/now/invisible-details)). Workflowy uses ⌘K to jump to any item ([Workflowy](https://community.workflowy.com/t/keyboard-shortcuts/1686)).
    - One discoverable entry point. Linear's first ticket was the command menu ([transcript](https://www.localfirst.fm/15/transcript)).

12. **Single-key actions in navigation mode, plus `g`-prefixed "go to" sequences and a `?` cheat sheet.** (Todoist, Linear, Logseq)
    - Examples: `e` complete, `t` date, `v` move, `x` select, `g t` Today ([Todoist](https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2); [Logseq](https://github.com/logseq/docs/blob/master/pages/Keyboard%20shortcuts.md)).
    - Unmodified keys avoid every browser conflict (see §6).

13. **Remappable shortcuts.** (Logseq, TickTick, Things via macOS)
    - "Customizable keyboard shortcuts is the only way to make everybody happy" ([Logseq](https://github.com/logseq/docs/blob/master/pages/Keyboard%20shortcuts.md)). Dvorak and Colemak users demand it ([HN](https://news.ycombinator.com/item?id=39758583)).
    - Keyboard-first users are layout-diverse.

14. **Keyboard date nudges: ±1 day and ±1 week without opening a picker.** (Things)
    - ^] / ^[ and ^⇧] / ^⇧[ ([Things](https://culturedcode.com/things/support/articles/2785159/)).
    - "We don't need calendar pickers when we have command palettes" ([HN](https://news.ycombinator.com/item?id=39758765)).

15. **Global, context-restoring undo with unlimited history.** (Logseq)
    - Undo navigates to the page where the change happened and restores the cursor ([Logseq](https://github.com/logseq/docs/blob/master/pages/Undo%20and%20Redo.md)).
    - In a deep tree you must *see* what was undone. Combine it with an "Undo" toast for destructive actions (Todoist shows one only for recurring completes) ([Todoist](https://www.todoist.com/help/todoist/features/introduction-to-tasks-080OAXric)).

16. **Completed items linger in place until a cleanup moment, with a "show/hide completed" toggle.** (Things Daily/Manual logging, OmniFocus Clean Up, Workflowy ⌘O)
    - See [Things](https://culturedcode.com/things/support/articles/2785159/), [OmniFocus](https://support.omnigroup.com/documentation/omnifocus/universal/4.10/en/print/) and [Workflowy](https://community.workflowy.com/t/keyboard-shortcuts/1686).
    - You see the checkmark and the strike, misclicks are recoverable, and lists don't jump under the cursor.

17. **Completion feedback: a satisfying checkbox, an optional sound, optional streaks.** (Todoist tone + Karma, Logseq)
    - Todoist's task-complete tone is off by default and toggled per platform. Karma goals and streaks can be paused for vacation ([Todoist](https://www.todoist.com/help/todoist/features/introduction-to-tasks-080OAXric); [Karma](https://www.todoist.com/help/todoist/features/introduction-to-karma-OgWkWy)).
    - OmniFocus users ask for a completion sound ([forum](https://discourse.omnigroup.com/t/is-there-a-task-completion-sound/70299)). Logseq's docs call checking a box "rather satisfying."

18. **Recurrence with both semantics: on schedule vs after completion.** (Todoist `every` / `every!`, Things, TickTick, Logseq `.+` / `++` / `+`)
    - See [Todoist](https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV), [Things](https://culturedcode.com/things/support/articles/2803564/), [Logseq](https://github.com/logseq/docs/blob/master/pages/Tasks.md) and [TickTick](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/).
    - "Water plants" and "pay rent" need different maths. **Reset child checklists on each recurrence:** Superlist was criticized for not doing so ([Product Hunt](https://www.producthunt.com/p/superlist/superlist-3) *(index snippet)*).

19. **Headings and sections inside a list.** (Things headings, Reminders sections, Todoist sections)
    - Dragging a heading moves its group ([Things](https://culturedcode.com/things/features/); [MacStories iOS 17](https://www.macstories.net/stories/ios-and-ipados-17-the-macstories-review/10/)).
    - Lightweight grouping without adding depth. Lists can model a heading as a non-checkable node.

20. **Mirrors: one item, many places.** (Workflowy)
    - "The same bullet in multiple places" ([Workflowy](https://workflowy.com/help/mirrors/) *(index snippet)*).
    - A task can live in a project tree *and* in a "Groceries" list without duplication. This is a later-phase feature.

21. **Smart views as saved queries over the tree.** (Tana live searches, OmniFocus Perspectives, Todoist filters)
    - See [Tana](https://outliner.tana.inc/learn/features/supertags) and [OmniFocus](https://www.omnigroup.com/omnifocus/features).
    - Today and Upcoming become two built-in queries, and power users can add their own later. In smart views, show a nested item with its breadcrumb path and keep its children collapsed behind a count, as Todoist does ([Todoist](https://www.todoist.com/help/articles/introduction-to-sub-tasks-kMamDo)).

22. **Paste-a-link / jump-to-any-item finder.** (Dynalist item finder, Workflowy ⌘K, Things Quick Find)
    - Unlimited depth is only usable if any node is two keystrokes away ([Dynalist](https://dynalist.io/features/full); [Things](https://culturedcode.com/things/features/)).

23. **Linear-style performance discipline.**
    - Set a latency budget, lazy-load rare features, ship modern-only bundles, preload, and keep a local replica so reads never wait on the network ([changelog](https://linear.app/changelog/2021-03-31-startup-performance-improvements); [transcript](https://www.localfirst.fm/15/transcript)).
    - This is directly applicable to "must work on slow 3G": render from IndexedDB first and sync second.

24. **Plain-text export/import as a trust contract.** (todo.txt, Dynalist backups, Godspeed's readable SQLite)
    - See [todo.txt](https://github.com/todotxt/todo.txt), [Dynalist](https://dynalist.io/features/full) and [HN](https://news.ycombinator.com/item?id=39759710).
    - Outliner loyalists fear abandonment (Dynalist, Logseq). An indented-Markdown / OPML export answers "what if you disappear?"

---

## 4. Avoid list

| Failure mode | Who did it | Evidence | Implication for Lists |
|---|---|---|---|
| **Depth limits on subtasks** | Google Tasks (flattened to 1 level in 2019), MS To Do (Steps only), Todoist (4), TickTick (5), RTM (3) | [gtaskd](https://www.gtaskd.com/google-ending-support-for-nested-subtasks/); [MS Tech Community](https://techcommunity.microsoft.com/discussions/to-do/request-for-option-to-add-1-extra-layer-of-sub-tasks-to-sub-tasks/3640196); [Todoist](https://www.todoist.com/help/articles/introduction-to-sub-tasks-kMamDo); [TickTick](https://blog.ticktick.com/2020/08/10/how-task-nesting-helps-you-with-gtd/); [RTM forum](https://www.rememberthemilk.com/forums/help/28361/): "Driving me nuts lately" | Unlimited depth is a real differentiator. Never retroactively flatten user data. |
| **Second-class sub-items** (no dates or reminders on children, can't repeat) | MS To Do steps, Google Tasks | [MS](https://techcommunity.microsoft.com/discussions/to-do/feature-request---due-dates-for-sub-tasks-in-microsoft-to-do/2538142); [Google](https://support.google.com/a/users/answer/9310236?hl=en): "Tasks with subtasks can't repeat" | Every node at every depth gets the same powers. |
| **Unrecoverable deletion** | Todoist ("no option to undo task deletion"), Things iOS (only the last delete, by shake) | [Todoist](https://www.todoist.com/help/todoist/features/introduction-to-tasks-080OAXric); [Things FAQ](https://culturedcode.com/things/support/articles/2967034/) | Soft-delete, an Undo toast, a Trash, and multi-step undo. Deleting a parent with 500 descendants must be one undo. |
| **Undo that dies at sync** | Taskwarrior | [task-sync(5)](https://taskwarrior.org/docs/man/task-sync.5/) *(index snippet)* | Model undo as new inverse operations, not log rollback, so undo survives sync. |
| **Fragile offline / data loss when local storage is cleared** | Todoist web | [Todoist](https://www.todoist.com/help/articles/use-todoist-while-offline-4rbaZw): "Don't close Todoist… or clear local data" | Request persistent storage. Show an unsynced-changes badge. Never discard unsynced ops silently. |
| **Sync failures surfaced as popups / conflicts that overwrite** | Superlist; Workflowy (offline overwrite); Logseq (file sync) | [Superlist review](https://hyperquest.digitalpress.blog/superlist-the-definitive-review/); [Workflowy comments](https://blog.workflowy.com/an-offline-desktop-app-for-workflowy/comment-page-1/) *(index snippet)*; [HN](https://news.ycombinator.com/item?id=48897286) | Per-field merges and quiet status indicators instead of modals. Test concurrent edits explicitly. Things ran its new cloud in parallel before cutover ([blog](https://culturedcode.com/things/blog/2025/05/a-swift-cloud/)). |
| **Performance collapse on big trees** | Workflowy (expand-all locked accounts), Todoist ("slugginess"), OmniFocus 4 (slower, more RAM), Logseq ("slow and buggy") | [Workflowy](https://blog.workflowy.com/why-we-disabled-expand-all-by-double-clicking-on-the-page-title-and-logo/); [HN](https://news.ycombinator.com/item?id=39758661); [MPU](https://talk.macpowerusers.com/t/omnifocus-4-release/35717?page=3) *(index snippet)*; [HN](https://news.ycombinator.com/item?id=48898981) | Virtualize rendering, lazy-expand, cap "expand all" behind an explicit command, and perf-test with 10k+ nodes. |
| **Feature bloat / clutter** | TickTick, Any.do desktop | [Capterra](https://www.capterra.com/p/170641/TickTick/reviews) *(index snippet)*; [Zapier](https://zapier.com/blog/best-todo-list-apps/): Any.do desktop "feels cluttered… more than a little confusing" | Things' approach: make "the concepts we've had in the app even simpler" ([Apple](https://apps.apple.com/us/story/id1390028519)). |
| **Subscription anger / price hikes / paywalling basics** | Todoist +40%, Any.do paywall, OmniFocus web gated behind a subscription, Logseq sync pricing | [Todoist](https://www.todoist.com/help/todoist/billing/todoist-pro-pricing-update-in-2025-bxBvHZuJZ); [Capterra](https://www.capterra.com/p/173614/Any-do/reviews) *(index snippet)*; [Omni web](https://support.omnigroup.com/documentation/omnifocus/universal/4.9.3/en/web/) *(index snippet)*; [HN](https://news.ycombinator.com/item?id=33219781) | Keep the core (lists, nesting, dates, offline) free or one-price. Grandfather users. Things' one-time purchase is cited as a reason people love it ([MPU](https://talk.macpowerusers.com/t/what-do-you-love-about-things-3/27387)). |
| **Abandonment / stagnation** | Dynalist (no update since 2021), Logseq (years on the DB rewrite), Wunderlist (killed by its acquirer) | [Dynalist forum](https://talk.dynalist.io/t/dynalist-love-letter-and-request-for-maintenance-mode/10048); [HN](https://news.ycombinator.com/item?id=48896645); [HN](https://news.ycombinator.com/item?id=14154378) | Visible changelog cadence and export-anytime. |
| **Platform lock-in** | Things (Apple-only), OmniFocus (Apple + paid web) | [Zapier](https://zapier.com/blog/best-todo-list-apps/); [HN](https://news.ycombinator.com/item?id=39758633) | The web-first PWA is an opening: Things users can't use Things on a work Windows laptop. |
| **Broken keyboard basics in "keyboard" apps** | Superlist (Tab, Shift-select), Reminders (Tab doesn't indent on Mac) | [Superlist review](https://hyperquest.digitalpress.blog/superlist-the-definitive-review/); [9to5Mac](https://9to5mac.com/2019/10/16/make-subtasks-reminders-iphone-ipad-mac/) *(index snippet)* | Tab, ⇧Tab, ⇧↑/↓, Enter and Esc must be bulletproof before anything fancy. |
| **Overloaded or accidental gestures** | Workflowy double-click-to-select also triggered expand-all | [Workflowy](https://blog.workflowy.com/why-we-disabled-expand-all-by-double-clicking-on-the-page-title-and-logo/) | Never bind a destructive or expensive action to a common text-editing gesture. |
| **Guilt UI** | Red overdue counts (the contrast Things draws) | [Viticci](https://www.macstories.net/stories/things-automation/) | Neutral overdue styling plus a "Rescue overdue" action. |
| **Weak NL parsing** | Apple Reminders | [MacStories](https://www.macstories.net/stories/ios-and-ipados-27-review/12/) | Parser test suite. Always show what was parsed before committing. |

---

## 5. What wins awards and loyalty

### Things 3: Apple Design Award 2017 (its second; the first was 2009)

**The award itself**
- Things 3 was one of 7 app winners at the 2017 ADAs, alongside Bear, Airmail 3, Lake, Kitchen Stories, Elk and Enlight ([MacRumors](https://www.macrumors.com/2017/06/07/2017-apple-design-award-winners-announced/)).
- Apple honors "outstanding design and innovation" ([Cultured Code](https://culturedcode.com/things/blog/2017/06/back-from-wwdc/)).
- Things also won MacStories Selects Best App Update (2018) and Best New Feature (2023, for Shortcuts integration that exposes the current selection) ([Wikipedia](https://en.wikipedia.org/wiki/Things_(software)); [MacStories Selects 2023](https://www.macstories.net/stories/macstories-selects-2023-recognizing-the-best-apps-of-the-year/)).

**What reviewers and Apple singled out**
- **Interaction delight in task entry.** Magic Plus "add[s] a welcome element of delight to the job of task creation" ([MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/) *(index snippet)*). Things' own pitch is "The new plus button adds some magic to every interaction" ([features](https://culturedcode.com/things/features/)).
- **Content-first minimalism.** The redesign aims to "put user content front and center." To-dos adapt to show only the metadata they carry, and projects have progress pies ([MacRumors](https://www.macrumors.com/2017/05/18/things-3-task-manager-for-mac-ios-and-apple-watch/)).
- **Fewest steps.** Apple's editorial says Things lets you triage with "the fewest taps possible" ([App Store story](https://apps.apple.com/us/story/id1390028519)).
- **Restraint as strategy.** CEO Werner Jainek says "unrivaled simplicity" guides the design. Rather than adding features, the team aims at "making the concepts we've had in the app even simpler" ([App Store story](https://apps.apple.com/us/story/id1390028519)).
- **A mental model that matches life.** Start vs Deadline, Today/This Evening and Someday ([MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/); [Viticci](https://www.macstories.net/stories/things-automation/)).
- **Platform-native feel.** Haptics "shine most" on iPhone, and keyboard support on Mac is "excellent" ([MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)). The release notes promise "delightful animations" ([iPhone release notes](https://culturedcode.com/things/support/articles/2409121/) *(index snippet)*).
- **Calm.** No red overdue, and "doesn't stress me out" ([Viticci](https://www.macstories.net/stories/things-automation/)).
- **Reliability of sync.** It "just works," and Things Cloud was rebuilt invisibly over about 4 years ([blog](https://culturedcode.com/things/blog/2025/05/a-swift-cloud/)).

### The current ADA rubric

The 2026 awards were given in six categories, including **Delight and Fun**, **Interaction**, **Inclusivity**, **Innovation**, **Social Impact** and **Visuals and Graphics** ([Apple Newsroom 2026](https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/) *(index snippet)*). The planner Structured was a 2026 Inclusivity finalist; neurodivergent users praised its "simple layout" ([developer.apple.com](https://developer.apple.com/design/awards/) *(index snippet)*).

**Mapping to Lists:**
- **Interaction:** keyboard model and drag-to-place.
- **Delight:** completion moment.
- **Inclusivity:** calm UI, reduced motion, screen-reader-friendly tree.

### Patterns behind long-term loyalty, across apps

1. **Opinionated simplicity that still scales.** Things users stay because the app "is what it is" and they stop tinkering ([MPU](https://talk.macpowerusers.com/t/what-do-you-love-about-things-3/27387)). "Been using Things for 8–9 years… keep coming back" ([HN](https://news.ycombinator.com/item?id=39758765)).
2. **Speed and keyboard fluency.** Godspeed's Show HN (328 points) drew people "frustrated with the lack of keyboard support" in heavyweight apps ([HN](https://news.ycombinator.com/item?id=39758773)). Linear's quality-first stance is the north star: "feel so good that you wouldn't want to use anything else" ([transcript](https://www.localfirst.fm/15/transcript)).
3. **Data trust.** Users want to own their data: readable local DBs, exports and backups ([HN](https://news.ycombinator.com/item?id=39759710); [Dynalist](https://dynalist.io/features/full); [todo.txt](https://github.com/todotxt/todo.txt)).
4. **Fair, predictable pricing.** One-time or stable pricing is praised ([MPU](https://talk.macpowerusers.com/t/what-do-you-love-about-things-3/27387)). Hikes trigger comparison shopping ([Todoist](https://www.todoist.com/help/todoist/billing/todoist-pro-pricing-update-in-2025-bxBvHZuJZ)).
5. **Shared lists for households.** This was Wunderlist's lasting appeal ([HN](https://news.ycombinator.com/item?id=14154841)). Superlist's founders are betting on it again ([TechCrunch](https://techcrunch.com/2024/02/16/superlist/)).

---

## 6. Recommended keyboard shortcut map

### Constraints from the browser (macOS Chrome)

- **Reserved: never delivered to the page.** Chrome and Safari on macOS reserve ⌘N, ⌘W, ⌘Q, ⌘T, Ctrl+Tab and Ctrl+Shift+Tab. Chrome also reserves Ctrl+PageUp/PageDown ([W3C UI Events thread](https://lists.w3.org/Archives/Public/public-webapps-github/2016Jan/0255.html)). Chromium confirms that Ctrl/⌘ + T/W/N and their Shift variants "are not sent to the web app" ([blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/wlRDnLbyVlk)); see also [Mozilla bug 1052569](https://bugzil.la/1052569).
  - So ⌘N "new to-do" (Things, Reminders, MS To Do) and ⌘T "Today" (Things, Reminders) **cannot work in a web app.**
- **Interceptable but owned by Chrome** ([Chrome help](https://support.google.com/chrome/answer/157179?hl=en&co=GENIE.Platform%3DDesktop)). Overriding them surprises users if focus is outside the app:

  | Chrome shortcut | Chrome action |
  |---|---|
  | ⌘[ / ⌘] | Back / Forward |
  | ⌘L | Address bar |
  | ⌘D | Bookmark |
  | ⌘⇧D | Bookmark all tabs |
  | ⌘Y | History |
  | ⌘⇧B | Bookmarks bar |
  | ⌘O | Open file |
  | ⌘, | Settings |
  | ⌘F / ⌘G | Find / next match |
  | ⌘E | Use selection for Find |
  | ⌘S | Save page |
  | ⌘P | Print |
  | ⌘1–⌘9 | Switch tabs |
  | ⌘⌥←/→ | Previous / next tab |
  | ⌘⇧M | Switch profile |
  | ⌘⇧Delete | Clear browsing data |
  | ⌘⇧J | Downloads |
  | ⌘⌥I / ⌘⌥J | DevTools / JS console |

  - Google Tasks proves ⌘] / ⌘[ can be captured on the web ([Google](https://support.google.com/tasks/answer/7675630?hl=en&co=GENIE.Platform%3DDesktop)). Workflowy captures ⌘, ([Workflowy](https://community.workflowy.com/t/keyboard-shortcuts/1686)).
- **Free on macOS Chrome:** ⌘K, ⌘Enter, ⌘↑/↓ (caret movement only inside text fields), ⌘. and any **Control** combination. Todoist deliberately uses **Control+]** to indent on Mac ([Todoist](https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2)).
- **macOS system:** Ctrl+Space is "select previous input source" by default. Things' Quick Entry (^Space) and Workflowy's expand/collapse (Control+Space) collide with it for multilingual users ([Things](https://culturedcode.com/things/support/articles/2785159/); [Workflowy](https://community.workflowy.com/t/keyboard-shortcuts/1686)).

**Design rule.** Use two modes, like Todoist, Linear and Logseq:
- **Navigate mode** (a row is selected, no text caret) uses unmodified single keys, which conflict with nothing.
- **Edit mode** (caret in a row) uses outliner conventions (Workflowy/Dynalist) plus ⌘ combinations that Chrome leaves alone.
- Make every binding remappable (Logseq, TickTick).

### Proposed map

**Capture and create**

| Action | Keys | Precedent | Conflict notes |
|---|---|---|---|
| New item below (navigate mode) | `Enter` / `o` | Google Tasks Enter; Things Space | none |
| New sibling while typing | `Enter` | Workflowy, Dynalist, Todoist | none |
| Line break / note in item | `Shift+Enter` | Workflowy, Dynalist | none |
| New item above | `Shift+O` (nav); `Ctrl+Enter` (edit) | Todoist Ctrl+Enter above | none |
| Quick Add (inline grammar) from anywhere in app | `q` | Todoist `q` | Do **not** use ⌘N (reserved) |
| Add at top / bottom of current list | `Shift+A` / `a` | Todoist | none |
| Paste multi-line → items (indent → nesting) | `⌘V` in nav mode | Things, Godspeed | none (native paste) |

**Structure (unlimited nesting)**

| Action | Keys | Precedent | Conflict notes |
|---|---|---|---|
| Indent / outdent | `Tab` / `Shift+Tab` (primary); `Ctrl+]` / `Ctrl+[` (alt) | Workflowy, Dynalist, Logseq; Todoist Ctrl+] | Must `preventDefault` Tab focus traversal inside the tree only. Provide an escape hatch for accessibility (Esc, then Tab leaves the tree). Avoid ⌘] / ⌘[ as primary (Chrome Back/Forward). |
| Move item up / down (with subtree) | `⌘⇧↑` / `⌘⇧↓` | Workflowy | ⌘⇧↑ extends text selection inside an input. Apply in nav mode, or when the caret is at line start/end. |
| Expand / collapse | `⌘↓` / `⌘↑`; toggle `⌘.` | Workflowy (⌘↑/↓), Dynalist (⌘.) | In edit mode, ⌘↑/↓ normally moves the caret to the start/end of the text. Acceptable in a single-line row. |
| Expand all / collapse all (explicit only) | `⌘⇧.` | Dynalist | Never on double-click (Workflowy lesson) |
| Zoom into item / zoom out / home | `z` (nav) or click bullet / `Shift+Z` (nav) or the browser's own Back (⌘[) / `⌘'` home | Workflowy ⌘. / ⌘, / ⌘'; Dynalist ⌘] / ⌘[ | Don't override ⌘, (Chrome Settings). Avoid ⌘⌥←/→ (Chrome tab switch). Make zoom a URL route so the unmodified browser Back zooms out; no override needed. |
| Jump to any item (fuzzy) | `⌘K` → type, or `/` | Workflowy ⌘K, Linear, Todoist ⌘K | ⌘K is unbound in Chrome Mac. Keep Chrome's ⌘F as page find. |

**Act on items (navigate mode unless noted)**

| Action | Keys | Precedent | Conflict notes |
|---|---|---|---|
| Complete / uncomplete | `⌘Enter` (both modes); `e` or `Space` (nav) | Workflowy/Dynalist ⌘Enter; Todoist `e`; OmniFocus/Google Tasks Space | Space scrolls the page if not handled. Handle it only when a row is focused. |
| Schedule / set date (NL input) | `t` (opens "When" with NL field) | Todoist `t` | ⌘T reserved |
| Today / This evening / Someday quick-set | in the date field type `tod` / `eve` / `som` (prefix completion), or `t` then `t` | Things prefix parsing; TW named dates | avoids ⌘T / ⌘E |
| Nudge date ±1 day / ±1 week | `]` / `[` · `Shift+]` / `Shift+[` (nav mode) | Things uses ^] / ^[ · ^⇧] / ^⇧[ | Things' Ctrl bindings would clash with the Ctrl+] indent alias. Unmodified brackets in nav mode avoid both that and Chrome's ⌘[ / ⌘]. |
| Remove date | `Shift+T` | Todoist | none |
| Deadline | `d` | OmniFocus `D` due | ⌘D = bookmark; avoid |
| Move to another list | `v` (or `m`) | Todoist `v`; Things ⇧⌘M | ⌘⇧M = Chrome profile switcher; avoid |
| Delete (with undo toast) | `⌘⌫` | Todoist, OmniFocus | Avoid **⌘⇧⌫** (Workflowy/Dynalist) because it is Chrome "Delete browsing data" |
| Select / extend selection | `x` toggle; `Shift+↑/↓` extend; `⌘A` all in list; `Esc` clear | Linear, Todoist, Things, Dynalist | ⌘A in edit mode selects text; Dynalist's "one more level up" escalation is a nice touch |
| Command palette (acts on selection) | `⌘K` | Linear, Todoist | none |

**Navigate**

| Action | Keys | Precedent | Conflict notes |
|---|---|---|---|
| Move focus down / up | `j` / `k`, `↓` / `↑` | Todoist | none |
| Go to Today / Upcoming / Inbox / All lists | `g t` / `g u` / `g i` / `g l` | Todoist `g` then letter; Linear; Logseq | Things uses ⌘1–⌘6, which are **Chrome tab switching**. Avoid. |
| Search / filter | `/` | Todoist, Linear | none |
| Toggle show completed | `Shift+H` (nav) | Reminders ⇧⌘H; Workflowy ⌘O | ⌘O = Chrome Open file; ⌘H = hide Chrome |
| Toggle sidebar | `m` or `⌘\` | Todoist `m` | none |
| Shortcut cheat-sheet | `?` (also `⌘/`) | Todoist, TickTick, Linear; Workflowy ⌘/ | none |

**History**

| Action | Keys | Precedent | Conflict notes |
|---|---|---|---|
| Undo / Redo | `⌘Z` / `⌘⇧Z` | universal | Don't make ⌘Y the redo (Chrome History) |

**Things/Reminders shortcuts that cannot be ported to the web as-is:**

| Native shortcut | Native action | Chrome conflict |
|---|---|---|
| ⌘N | new | reserved |
| ⌘T | Today | reserved |
| ⌘E | This Evening | Find selection |
| ⌘L | show in parent | address bar |
| ⌘D | duplicate | bookmark |
| ⌘1–6 | lists | tabs |
| ⇧⌘M | move | profile switcher |
| ⌘K | complete | Things' complete clashes with the palette convention; Reminders' ⌘K = this weekend |

Sources: [Things](https://culturedcode.com/things/support/articles/2785159/), [Reminders](https://support.apple.com/guide/reminders/keyboard-shortcuts-remn19b3424c/mac), [Chrome](https://support.google.com/chrome/answer/157179?hl=en&co=GENIE.Platform%3DDesktop).

**Mobile / touch parity**
- Drag-to-place "+" (Things, TickTick).
- Swipe right to complete, swipe left to schedule (Any.do origins; Apple's editorial on Things) ([Android Police](https://www.androidpolice.com/2011/11/10/new-app-any-do-from-the-creators-of-taskos-is-the-cleanest-task-list-app-for-android-yet-with-emphasis-on-sharing-and-simplicity/); [App Store](https://apps.apple.com/us/story/id1390028519)).
- An Undo toast instead of "shake to undo."

---

## Sources

**Things / Cultured Code**
- Keyboard shortcuts: https://culturedcode.com/things/support/articles/2785159/
- Features: https://culturedcode.com/things/features/
- Today/Upcoming/Anytime/Someday: https://culturedcode.com/things/support/articles/4001304/
- Repeating to-dos: https://culturedcode.com/things/support/articles/2803564/
- Natural language input: https://culturedcode.com/things/support/articles/9780167/
- FAQ (undo / deletion): https://culturedcode.com/things/support/articles/2967034/
- iPhone release notes: https://culturedcode.com/things/support/articles/2409121/
- Things 3.1 (date parsing, repeats in projects): http://culturedcode.com/things/blog/2017/07/things-3-1-repeating-to-dos-date-parsing/
- Back from WWDC (ADA 2017): https://culturedcode.com/things/blog/2017/06/back-from-wwdc/
- A Swift Cloud: https://culturedcode.com/things/blog/2025/05/a-swift-cloud/
- Wikipedia (awards, history): https://en.wikipedia.org/wiki/Things_(software)
- MacStories review: https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/
- MacStories, Things 3.4 automation (Viticci): https://www.macstories.net/stories/things-automation/
- MacStories Selects 2023: https://www.macstories.net/stories/macstories-selects-2023-recognizing-the-best-apps-of-the-year/
- MacRumors launch: https://www.macrumors.com/2017/05/18/things-3-task-manager-for-mac-ios-and-apple-watch/
- MacRumors ADA 2017 winners: https://www.macrumors.com/2017/06/07/2017-apple-design-award-winners-announced/
- App Store editorial: https://apps.apple.com/us/story/id1390028519
- The Sweet Setup GTD pick: https://thesweetsetup.com/weve-updated-our-review-of-the-best-gtd-app-suite-for-iphone-ipad-and-mac/
- MPU forum, "What do you love about Things 3?": https://talk.macpowerusers.com/t/what-do-you-love-about-things-3/27387
- sspai (no sub-projects): https://sspai.com/post/39653

**Todoist**
- Keyboard shortcuts: https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2
- Sub-tasks: https://www.todoist.com/help/articles/introduction-to-sub-tasks-kMamDo
- Recurring dates: https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV
- Dates and time: https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO
- Tasks (complete, undo, delete, sound): https://www.todoist.com/help/todoist/features/introduction-to-tasks-080OAXric
- Offline: https://www.todoist.com/help/articles/use-todoist-while-offline-4rbaZw
- Karma: https://www.todoist.com/help/todoist/features/introduction-to-karma-OgWkWy
- Productivity view: https://www.todoist.com/help/todoist/features/use-the-productivity-view-in-todoist-6S63uAa9
- 2025 pricing update: https://www.todoist.com/help/todoist/billing/todoist-pro-pricing-update-in-2025-bxBvHZuJZ
- 2026 changelog: https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd
- Archived homepage (Verge quote): https://webcf.waybackmachine.org/web/20211022050253/https://todoist.com

**TickTick**
- Multilevel tasks: https://help.ticktick.com/articles/7055782219767349248
- Smart Recognition: https://help.ticktick.com/articles/7081924556310446080
- Desktop shortcuts: https://help.ticktick.com/articles/7055780449171275776
- Add tasks: https://help.ticktick.com/articles/7055782422935240704
- Mac page: https://ticktick.com/mac?language=en_us
- 20 lesser-known features: https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/
- Task nesting / GTD: https://blog.ticktick.com/2020/08/10/how-task-nesting-helps-you-with-gtd/
- Capterra reviews: https://www.capterra.com/p/170641/TickTick/reviews

**OmniFocus**
- Features: https://www.omnigroup.com/omnifocus/features
- Commands and shortcuts: https://support.omnigroup.com/documentation/omnifocus/universal/4.3.3/en/commands-and-shortcuts/
- OmniFocus 4.10 manual (printable): https://support.omnigroup.com/documentation/omnifocus/universal/4.10/en/print/
- OmniFocus for the Web: https://support.omnigroup.com/documentation/omnifocus/universal/4.9.3/en/web/
- Forum, completion sound: https://discourse.omnigroup.com/t/is-there-a-task-completion-sound/70299
- MPU, OmniFocus 4 release: https://talk.macpowerusers.com/t/omnifocus-4-release/35717?page=3
- TidBITS (pricing): https://tidbits.com/watchlist/and-omnifocus-4-0-1/

**Microsoft To Do / Wunderlist**
- Keyboard shortcuts: https://support.microsoft.com/en-us/todo/using-keyboard-shortcuts-in-microsoft-to-do
- My Day: https://support.microsoft.com/en-us/todo/my-day-and-suggestions
- Steps: https://support.microsoft.com/en-us/office/add-steps-importance-notes-tags-and-categories-to-your-tasks-bf9fdff6-f85f-4e03-9534-c587eb32515c
- Tech Community, step due dates: https://techcommunity.microsoft.com/discussions/to-do/feature-request---due-dates-for-sub-tasks-in-microsoft-to-do/2538142
- Tech Community, extra sub-task layer: https://techcommunity.microsoft.com/discussions/to-do/request-for-option-to-add-1-extra-layer-of-sub-tasks-to-sub-tasks/3640196
- TechCrunch, Wunderlist shutdown: https://techcrunch.com/2019/12/09/microsoft-to-finally-shut-down-to-do-list-app-wunderlist-on-may-6-2020
- Wikipedia, Wunderlist: https://en.wikipedia.org/wiki/Wunderlist
- HN, Wunderlist shutdown thread: https://news.ycombinator.com/item?id=14154378 (comments 14155842, 14154841)

**Apple Reminders**
- Subtasks: https://support.apple.com/guide/reminders/add-subtasks-to-reminders-remn32a9622b/mac
- Keyboard shortcuts: https://support.apple.com/guide/reminders/keyboard-shortcuts-remn19b3424c/mac
- MacStories iOS 17 review: https://www.macstories.net/stories/ios-and-ipados-17-the-macstories-review/10/
- MacStories iOS 18 review: https://www.macstories.net/stories/ios-and-ipados-18-the-macstories-review/10/
- MacStories iOS 27 review: https://www.macstories.net/stories/ios-and-ipados-27-review/12/
- 9to5Mac, subtasks: https://9to5mac.com/2019/10/16/make-subtasks-reminders-iphone-ipad-mac/

**Workflowy**
- Keyboard shortcuts: https://community.workflowy.com/t/keyboard-shortcuts/1686
- Get started: https://community.workflowy.com/t/get-started/1650
- Why expand-all was disabled: https://blog.workflowy.com/why-we-disabled-expand-all-by-double-clicking-on-the-page-title-and-logo/
- Mirrors help: https://workflowy.com/help/mirrors/
- Mirrors blog: https://blog.workflowy.com/mirrors-create-live-copies-of-any-bullet/
- WorkFlowy goes offline: https://blog.workflowy.com/workflowy-goes-offline/
- Offline desktop app (comments): https://blog.workflowy.com/an-offline-desktop-app-for-workflowy/comment-page-1/
- Pricing: https://beta.workflowy.com/pricing

**Dynalist**
- Keyboard shortcut reference: https://help.dynalist.io/article/91-keyboard-shortcut-reference
- Full feature list: https://dynalist.io/features/full
- Google Calendar integration: https://help.dynalist.io/article/134-google-calendar-integration
- Forum, development status: https://talk.dynalist.io/t/what-is-the-current-state-of-the-developement-of-dynalist/8472
- Forum, "love letter" / maintenance mode: https://talk.dynalist.io/t/dynalist-love-letter-and-request-for-maintenance-mode/10048

**Logseq / Tana**
- Logseq Tasks: https://github.com/logseq/docs/blob/master/pages/Tasks.md
- Logseq keyboard shortcuts: https://github.com/logseq/docs/blob/master/pages/Keyboard%20shortcuts.md
- Logseq undo and redo: https://github.com/logseq/docs/blob/master/pages/Undo%20and%20Redo.md
- HN, Logseq 2.0 beta: https://news.ycombinator.com/item?id=48896229 (comments 48896645, 48896838, 48898981, 48897286)
- HN, Logseq launch: https://news.ycombinator.com/item?id=33218561 (comment 33219781)
- Tana supertags: https://outliner.tana.inc/learn/features/supertags
- Tana simple task management: https://outliner.tana.inc/articles/simple-task-management

**Superlist / TeuxDeux / Any.do / Google Tasks**
- Superlist: https://superlist.com/
- TechCrunch, Superlist launch: https://techcrunch.com/2024/02/16/superlist/
- Superlist definitive review: https://hyperquest.digitalpress.blog/superlist-the-definitive-review/
- Product Hunt, Superlist 3: https://www.producthunt.com/p/superlist/superlist-3
- TeuxDeux: https://teuxdeux.com/
- swiss-miss on TeuxDeux: https://www.swiss-miss.com/teuxdeux
- Any.do, overdue tasks: https://support.any.do/en/articles/8635857-managing-overdue-personal-tasks
- Android Police, Any.do launch: https://www.androidpolice.com/2011/11/10/new-app-any-do-from-the-creators-of-taskos-is-the-cleanest-task-list-app-for-android-yet-with-emphasis-on-sharing-and-simplicity/
- Capterra, Any.do reviews: https://www.capterra.com/p/173614/Any-do/reviews
- TechRadar, Any.do: https://www.techradar.com/reviews/anydo-calendar-app
- Google Tasks shortcuts: https://support.google.com/tasks/answer/7675630?hl=en&co=GENIE.Platform%3DDesktop
- Google Tasks add/edit: https://support.google.com/a/users/answer/9310236?hl=en
- Google ending nested subtasks: https://www.gtaskd.com/google-ending-support-for-nested-subtasks/
- Remember The Milk, subtask levels: https://www.rememberthemilk.com/forums/help/28361/

**todo.txt / Taskwarrior**
- todo.txt format: https://github.com/todotxt/todo.txt
- Taskwarrior urgency: https://taskwarrior.org/docs/urgency/
- Taskwarrior recurrence: https://taskwarrior.org/docs/recurrence/
- Taskwarrior named dates: https://taskwarrior.org/docs/named_dates/
- task(1) man page: https://taskwarrior.org/docs/man/task.1/
- task-sync(5) man page: https://taskwarrior.org/docs/man/task-sync.5/

**Linear**
- Invisible details: https://linear.app/now/invisible-details
- Select issues: https://linear.app/docs/select-issues
- Team pages: https://linear.app/docs/default-team-pages
- Search: https://linear.app/docs/search
- Startup performance changelog: https://linear.app/changelog/2021-03-31-startup-performance-improvements
- How we built Triage Intelligence: https://linear.app/now/how-we-built-triage-intelligence
- Scaling the sync engine: https://linear.app/now/scaling-the-linear-sync-engine
- Rethinking the startup MVP: https://linear.app/now/rethinking-the-startup-mvp-building-a-competitive-product
- localfirst.fm #15 transcript: https://www.localfirst.fm/15/transcript
- Talk, "Unexpected benefits of going local-first": https://www.youtube.com/watch?v=VLgmjzERT08
- Secondary summary: https://second-brain-nuxt.vercel.app/unexpected-benefits-of-going-local-first

**Roundups / awards**
- Zapier, best to-do list apps: https://zapier.com/blog/best-todo-list-apps/
- Apple Newsroom, 2026 ADA winners: https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/
- Apple Design Awards: https://developer.apple.com/design/awards/

**User discussion (Hacker News)**
- Godspeed Show HN: https://news.ycombinator.com/item?id=39756325 (comments 39761740, 39770808, 39758583, 39758633, 39758661, 39758765, 39758773, 39758806, 39759710, 39760187, 39761090, 39761892, 39761940, 39763342)
- Taskwarrior thread: https://news.ycombinator.com/item?id=17029560

**Browser shortcut conflicts**
- Chrome keyboard shortcuts: https://support.google.com/chrome/answer/157179?hl=en&co=GENIE.Platform%3DDesktop
- W3C UI Events thread (reserved keys): https://lists.w3.org/Archives/Public/public-webapps-github/2016Jan/0255.html
- blink-dev, browser shortcuts in fullscreen: https://groups.google.com/a/chromium.org/g/blink-dev/c/wlRDnLbyVlk
- Mozilla bug 1052569: https://bugzil.la/1052569
