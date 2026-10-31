# ToDo

A self-hosted, single-user task app in the spirit of Apple Reminders. Lists, due dates, urgent flags, recurring reminders, natural-language quick add, smart lists, floating time zones, a token API for external agents, completed history, dark mode, and web push. No frontend framework and no build step.

## What's New in v2.11.1

- **Sheets close instantly again** - removed the v2.11.0 exit fade on the editor, list, Settings and other sheets that caused jitter when saving or cancelling. The opening motion is unchanged.
- **"See more" for long notes** - notes still show a two-line preview with the usual ellipsis, but when the note overflows a quiet **See more** button appears. Tapping it expands the full note in place with a height animation; **See less** collapses it. Works in lists, search results, completed rows and the Home day card. The row still never opens the editor unless you use the pencil, and short notes get no button.
- Service worker cache bumped to `todo-v2.11.1`.

## What's New in v2.11.0

- **Fluid motion across the app** - completing or un-completing a task now glides the row between Open and Completed (with the old gap closing), rather than disappearing and reappearing. Added rows settle in, deleted rows collapse, and a list emptied by the last item fades to its empty state.
- **Sorting and date changes move the rows** - changing Sort/Order, rescheduling, snoozing, skipping or advancing a repeating item now slides rows to their new position/group instead of teleporting. Dragging or keyboard-moving a list settles it into its new order.
- **Show Completed opens and closes** - the completed section expands and collapses with a height/opacity transition instead of swapping instantly.
- **Navigation surfaces** - sheets keep their card visible during a short exit animation, the account menu fades/scales, toasts fade out, and list/view content fades in on navigation and after the initial skeleton.
- **Micro feedback** - editor date/time/model/repeat/history rows expand and collapse, field errors slide in, nav and day-strip counts pulse, the seven-day strip rolls at midnight, and list progress bars/rings animate. Theme and density changes use a View Transition where supported.
- **Reduced motion** still turns all of the above into instant state changes.
- Service worker cache bumped to `todo-v2.11.0`.

## What's New in v2.10.10

- **Completion ring stays empty at rest** - removed the faint tick inside the circle on incomplete items. The polished hover/focus ring and light list-colour wash remain, and a completed item still fills with its full-contrast check and the short completion halo.
- Service worker cache bumped to `todo-v2.10.10`.

## What's New in v2.10.9

- **A clearer completion control** - the empty ring now carries a faint check at rest, so it reads as a checkbox rather than a radio button. Hover/focus tints the ring and check with the list colour and adds a light wash; completing fills the circle, shows the full check, pops it gently with a short ring pulse, then strikes the title. The 24px control and 44px touch target are unchanged.
- Service worker cache bumped to `todo-v2.10.9`.

## What's New in v2.10.8

- **Closing a swipe follows your finger** - after swiping left to reveal Delete, dragging right now slides the row back under the finger at the same pace instead of snapping shut on the first few pixels. Releasing before the close threshold returns it open; releasing past it closes it with the same 0.18s ease as opening. A parked row can still be closed with a tap.
- Service worker cache bumped to `todo-v2.10.8`.

## What's New in v2.10.7

- **Edit is an explicit button** - tapping or clicking a reminder row no longer opens it, so an accidental tap is harmless. Every row now has a pencil button on the right; only that button opens the editor. On desktop the pencil sits left of the hover delete ×; on mobile the × is hidden and swipe-left still reveals Delete. Checkboxes, Snooze/Reschedule, links and swipe behaviour are unchanged.
- Service worker cache bumped to `todo-v2.10.7`.

## What's New in v2.10.6

- **Expanded days show every item** - the day card no longer caps at four rows or scrolls inside itself. Opening a day renders all of its reminders and the Home page scrolls normally, which removes the nested-scroll conflict on iPhone. The drawer frame, completion, row actions and editor behaviour are unchanged; an empty day still says "Nothing due".
- Service worker cache bumped to `todo-v2.10.6`.

## What's New in v2.10.5

- **Expanded days join the calendar drawer** - the strip and the open day card now share one outer tinted frame, border and rounded corners. The card runs full-bleed inside the drawer and keeps its own surface, so it reads as the panel opening rather than a second card appearing below it.
- **Card scrolling no longer fights Home on iPhone** - the card's native overscroll is now disabled instead of just contained, and a boundary guard stops Home from taking the gesture when the card is at its bottom. Reversing direction goes straight back to the card, so the first downward swipe should immediately return toward the first item. Pull-to-refresh still only arms from the top.
- Service worker cache bumped to `todo-v2.10.5`.

## What's New in v2.10.4

- **The seven-day strip is one calendar card** - the rolling week now sits in a soft rounded panel (5% theme-text tint, 1px soft border, 6px padding, 14px radius) instead of floating directly on Home. Today's gray fill and the selected-day accent outline are unchanged, and all seven cells still fit on a 320px screen at large text.
- Service worker cache bumped to `todo-v2.10.4`.

## What's New in v2.10.3

- **Scrolling inside an expanded day no longer fights refresh** - pull-to-refresh is now armed only when a touch starts with the day card and Home already at the top. A drag that begins inside a scrolled card is left entirely to the card, so it can scroll in either direction and reverse freely; the card's overscroll is contained so reaching its edge never drags Home or arms a refresh. Once the card is back at the top, lift and pull again to refresh. A normal pull from the top is unchanged.
- Service worker cache bumped to `todo-v2.10.3`.

## What's New in v2.10.2

- **Pull-to-refresh no longer hijacks the day card** - a downward drag inside an expanded day with more items than fit now scrolls the card back to its top first. The refresh pill and the request only start once every scroller (the card and Home) is at the top and the drag continues; lifting as soon as the card reaches the top does not refresh. The same rule applies when Home itself is scrolled, so pulling down reaches the top before refreshing.
- Service worker cache bumped to `todo-v2.10.2`.

## What's New in v2.10.1

- **Today's nav badge now explains overdue** - the Today row reads "Nothing due" when the day is clear, keeps a plain total when nothing is late, and shows the split when something is overdue: "4 · 2 overdue". When every Today item is overdue it shows just "2 overdue" instead of repeating the number. The overdue phrase uses the existing red token; the seven-day strip is unchanged and still leaves overdue items to the Today view. The Today row also carries a full accessible label ("Today, 4 items, 2 overdue").
- Service worker cache bumped to `todo-v2.10.1`.

## What's New in v2.10.0

- **Day Peek on Home** - a rolling seven-day strip now sits under Search: today first, then the next six days. Each cell shows the weekday, date and either one dot per open item (up to four) or the exact count from five. Today has a soft gray fill; a selected day gets an accent outline. Tap a day to open an inline card with its items using the normal rows (check, wrapped title, list colour/name, repeat and time); tapping the selected day again closes it, tapping another switches it in place. The card caps at about four rows and scrolls inside; empty days say "Nothing due". The strip rolls at local midnight and re-checks on resume, using the same local-date rules as Scheduled (overdue, completed and undated items are not counted). Expand/collapse and content crossfades respect reduced motion.
- Service worker cache bumped to `todo-v2.10.0`.

## What's New in v2.9.1

- **Shorter home labels** - the home heading now reads "To-dos" and the list section header reads "Lists" (still uppercase, so "LISTS"). Font, size, weight, spacing, colours and layout are unchanged.
- Service worker cache bumped to `todo-v2.9.1`.

## What's New in v2.9.0

- **Pull down to refresh on phones** - on touch devices in the mobile layout the header refresh icon is gone: pull down at the top of Home or any task list instead. A small pill shows "Pull to refresh" / "Release to refresh" / "Refreshing…" as you drag, then reports "Refreshed" when the same refresh run finishes. Desktop and web keep the refresh button, including a narrow desktop window.
- Service worker cache bumped to `todo-v2.9.0`.

## What's New in v2.8.9

- **"Show completed" is now a toggle in the sort bar** - inside a list it sits to the right of Sort and Order instead of as a link under the items, so it is visible without scrolling to the bottom. It shows the count ("Completed (3)") and is dimmed and disabled when the list has nothing completed. Same result as before: completed items appear under a Completed heading and count toward the list total, and the choice is still remembered per list.
- Service worker cache bumped to `todo-v2.8.9`.

## What's New in v2.8.8

- **Clock time sits with the date** - timed items now read "Fri, Nov 6 3:00 PM in 7 days": the time joins the date in the same bold weight and colour, and the relative countdown follows it.
- Service worker cache bumped to `todo-v2.8.8`.

## What's New in v2.8.7

- **Shorter countdown wording** - the relative due text now reads "in 3 days" instead of "due in 3 days".
- Service worker cache bumped to `todo-v2.8.7`.

## What's New in v2.8.6

- **Relative due dates** - each reminder's due line now also says how far away it is: "Mon, Nov 2 in 3 days", or "5 days overdue" for past items. It follows the date and clock time in the same light gray as the other metadata, and appears everywhere reminder rows are listed (Today, Scheduled, lists, search). Items due today or tomorrow keep just "Today" / "Tomorrow"; completed items never read as overdue.
- Service worker cache bumped to `todo-v2.8.6`.

## What's New in v2.8.5

- **Recurring delete warns from the list too** - v2.8.4 only guarded the editor's Delete Item button; deleting a repeating item by swiping its row (or the desktop ×) still deleted it silently. Both row paths now show the same persistent warning with Delete everything / Cancel, and the swipe closes first so the message is never half off-screen. One-off deletes are unchanged.
- Service worker cache bumped to `todo-v2.8.5`.

## What's New in v2.8.4

- **Tap-time undo order + steady history list** - undoing an older completion while a newer one is unstaged is refused immediately ("Undo the most recent completion first") instead of at Save; history rows paint in place so the list never jumps, and the already-completed warning reserves its line.
- **Autofill no longer sticks** - if the words that turned the date/time/repeat on are deleted again (and you haven't touched the fields yourself), the toggles revert to how they were.
- **Recurring delete warns first** - deleting a repeating series now explains it removes the whole series and its history (Skip removes just one occurrence); the button becomes "Delete everything" and only the second tap deletes. One-off deletes are unchanged.
- Service worker cache bumped to `todo-v2.8.4`.

## What's New in v2.8.3

- **History undos and snooze are staged until Save** - Undo skip, Undo completion, and the editor Snooze toggle now stage instead of applying instantly: rows dim with a "Staged ✓" tag (tap again to unstage), the date field previews the outcome, and Save lights up. Save applies staged undos newest-first, then the field edits; Cancel drops everything since nothing was ever sent. Staging any number of undos is trivial — it is just a small in-memory list.
- Service worker cache bumped to `todo-v2.8.3`.

## What's New in v2.8.2

- **Clearer series history** - completion history dates now include the year, and the list opens with a History header.
- Service worker cache bumped to `todo-v2.8.2`.

## What's New in v2.8.1

- **Clearer already-completed warning** - the editor note is shorter ("Already completed — completing again moves to the next date.") and sits below the date card with the same spacing as the other hints.
- Service worker cache bumped to `todo-v2.8.1`.

## What's New in v2.8.0

- **Undo a completion on repeating items** - each completed row in a series' history now has an Undo button. Undo removes that completion from history and puts the due date back, re-armed. It works most-recent-first (undo December before November) and only while the next occurrence hasn't passed yet — settled history stays settled, with a plain message when undo isn't available.
- **Completing after moving a date back works again** - moving a repeating item's date onto an already-completed day used to brick future completions with no message. Now a fresh tap re-records and advances the series; only a true double-tap within seconds is swallowed, and it says so instead of going silent.
- **Editor warns on already-completed dates** - picking a date that already has a completion shows a red note that completing will move the series to the next occurrence.
- Service worker cache bumped to `todo-v2.8.0`.

## What's New in v2.7.12

- **Dates lead each reminder** - the due date moves out of the metadata row onto its own line above the title, bold and in the page text color at the usual metadata size, so scanning a list reads dates first. Timed items keep the clock time beside the date in a quieter tone; date-only items show just the date. Overdue dates keep their red highlight, and the calendar icon stays with the date.
- **Stronger section headings** - Scheduled's group headings (Overdue, Today, Tomorrow, This Week, Next Week, Later This Month, Later) now use the same Fraunces serif and page-text color as the page title, a step smaller, replacing the small gray caps. Titles, metadata, notes, icons, list colors, spacing and all other typography are unchanged. Service worker cache bumped to `todo-v2.7.12`.

## What's New in v2.7.11

- **Snoozed items leave the app-icon badge** - reminders snoozed into the future no longer count toward the Home Screen icon badge, in pushed counts and on open alike; they rejoin the count automatically when the snooze fires, and expired snoozes still count. List rows, smart views, and push timing are unchanged. Service worker cache bumped to `todo-v2.7.11`.

## What's New in v2.7.10

- **Hourly snooze means the chosen next alert** - an explicit snooze now overrides the original alert time for both date-only and timed items, even when their usual alert is later. The task's date, Time switch, recurrence and badge rules stay unchanged. A successful snooze alert does not cause a second first-alert at the original time; configured repeat pushes still apply. Failed delivery remains eligible for retry. A concurrent snooze, completion or edit is not marked notified by an older in-flight dispatch. Service worker cache bumped to `todo-v2.7.10`.

## What's New in v2.7.9

- **Notifications update the app-icon badge** - every reminder push now carries the current count of unfinished items due today or overdue, and the service worker applies it to the Home Screen icon badge. Timed items badge at their scheduled time; date-only items badge when their notification fires at the configured Date-only time. The badge stays current without opening the app, and still refreshes on open as before. Needs iOS/iPadOS 16.4+ with the app on the Home Screen and notifications allowed; other platforms skip the badge silently. Service worker cache bumped to `todo-v2.7.9`.

## What's New in v2.7.8

- **Shorter Anchored label in the editor** - the Time model choice now reads "Specific timezone" instead of "A specific time zone (Anchored)", so it fits on phone-width screens without truncating; the helper text under the row still explains what it does. Service worker cache bumped to `todo-v2.7.8`.

## What's New in v2.7.7

- **Two time models: Floating and Anchored** — the editor's Time model row now offers **My local time (Floating)** (the default) or **Specific timezone** (Anchored). Fixed is gone as an everyday choice: everything it covered is expressed by the other two, and every existing Fixed item was converted to Floating (their stored dates and instants were untouched, so nothing fires at a different moment). The Settings default-model choice matches, and Floating remains the default everywhere, including when no setting exists yet. A legacy Fixed item arriving through an old backup still works; it opens in the editor as Floating.
- **Date-only items skip the time model** — the Time model row and its hint now appear only when an item has a clock time. A date-only item just asks for a date, since the model has no effect until a time exists. Service worker cache bumped to `todo-v2.7.7`.

## What's New in v2.7.6

A correctness release from an external assessment — four reproduced bugs fixed.

- **Failed pushes retry instead of vanishing** — a reminder used to be marked notified even when every push attempt failed (for example a transient network error), so with re-push off (the default) it was never tried again. The scheduler now stamps only after at least one device actually accepted the push; a fully failed attempt leaves the item armed for the next 15-second tick. Dead 404/410 subscriptions are still pruned.
- **Backups keep per-occurrence list and urgent overrides** — export now includes an occurrence's list and urgency, and import restores them. Older backup files without those fields still import cleanly (absent means "inherit the series").
- **Import counts are honest** — reimporting the same file now reports `occurrencesAdded: 0` instead of counting conflict no-ops as inserts; occurrences that already exist count as skipped.
- **Spring-forward no longer permanently shifts an early-morning series** — a daily 2:30am reminder in a DST zone rolled forward to 3:30 on the gap day and then stayed at 3:30 forever. The intended wall-clock time is now anchored on the repeat rule (like the monthly anchor day), so only the gap-day occurrence rolls forward and the series returns to 2:30 the next day. Existing series adopt the anchor from their current occurrence when they next advance. Service worker cache bumped to `todo-v2.7.6`.

## What's New in v2.7.5

- **Browser Back closes popovers** — when the Add/Edit item editor, Settings, the list sheet, the notification sheet, or the device-zone prompt is open, pressing Back (browser or Android hardware) now closes the topmost popover instead of navigating the screen behind it — the same result as **Escape** or Cancel (Settings restores its preview, editor edits are discarded). Nested popovers close one per Back press. After you close one normally with **Save**/**Cancel**, Back keeps navigating as before. Service worker cache bumped to `todo-v2.7.5`.

## What's New in v2.7.4

A correctness release — no new screens, several bugs no longer possible.

- **Repeating series survive month boundaries and DST** — daily, weekly, and week-unit series previously shifted +3 hours at every month boundary in a time zone (Oct 31 → Nov 1 was read as a DST gap and corrected the wrong way), and nonexistent wall times on spring-forward days landed 3–4 hours late. Occurrence math now normalizes dates before checking for a DST gap, so a 6pm series stays 6pm for good, and "2:30am on the transition day" rolls forward once instead of twice.
- **Weekday repeats from text** — "Every monday", "each fri", and "every other week" in a title now create real repeating rules: a weekly rule that always targets the next matching weekday, rather than silently creating a non-repeating item. Server labels read "Weekly on Monday".
- **Snooze actually snoozes again** — a snoozed item keeps its "already notified" stamp from the first fire, so with re-push off (the default) it could never notify again when the snooze ended. Snoozing now re-arms the reminder; it fires once when the snooze runs out.
- **Server stops dying on a failed request** — Express 4 does not catch rejected promises in async route handlers, so one slow disk read or database lock could restart the whole process. Every route's async handler now funnels failures into the normal error path.
- **Rapid double-taps can't skip a series day** — completing or skipping a repeating item twice in a row (two taps, notification button + editor, a racing retry) previously recorded the *next* occurrence too, silently skipping it. The advance is now conditional on the date the request started from, so exactly one tap wins.
- **The scheduler can't stamp a re-armed reminder** — if a push loop was still sending when you re-armed or completed an item, the late bookkeeping marked the *new* date as already-notified and it would never fire. Stamps are now bound to the specific occurrence that was pushed.
- **"This occurrence" edits save** — editing a single occurrence of a repeating item always failed with an error because the editor sends its device-zone echo alongside the edit; that harmless field is no longer rejected. Editing a date-only item also no longer rewrites its hidden timestamp to the current default time.
- **Backups import silently again** — the import endpoint's insert had one mismatched bind, so *every* imported reminder was counted "skipped" by a catch that hid the error; imported timestamps (e.g. `+05:30` offsets) are also normalized to the canonical UTC form the scheduler compares. Service worker cache bumped to `todo-v2.7.4`.

## What's New in v2.7.3

- **No time-model label on undated items** — the **Floating** / **Anchored** tag now appears only on items that actually have a date, since the time model has no effect until one exists. Previously every item created with the Floating default showed a "Floating" tag even without a date. Service worker cache bumped to `todo-v2.7.3`.

## What's New in v2.7.2

- **Item wording everywhere** — the rest of the interface now says **item** / **items** to match the **New Item / Edit Item / Delete Item** controls: hints, empty states, confirmations, toasts, accessibility labels, token and import copy, the notification fallback, and API error messages. The app name **ToDo** and the **Your TODOs** home heading are unchanged. Service worker cache bumped to `todo-v2.7.2`.

## What's New in v2.7.1

- **List progress syncs across devices** — the **List progress** and **Progress counts** choices now live in your server settings instead of this device's localStorage, so the phone and desktop show the same thing. Settings still previews instantly; **Save** applies the choice everywhere, **Cancel** leaves it untouched. Existing device-local choices migrate on first load. Theme and density stay per-device. Service worker cache bumped to `todo-v2.7.1`.

## What's New in v2.7.0

- **List progress in the sidebar** — each list can now show its open to-dos against its completed ones. The default **Bar with counts** draws a thin bar under the list name (the coloured part is what's done) with an "N open · M done" line; **Ring on the dot** puts the same ratio as a ring around the list's coloured dot; **Off** keeps the previous look. A second choice picks what the counts cover: **All completed** (default) or **Last 30 days**. Completed means finished items still in the list; a repeating to-do counts as open while its next occurrence is pending. Both choices live in Settings under Appearance and are device-specific, like theme and density. The Completed view is unchanged. Service worker cache bumped to `todo-v2.7.0`.

## What's New in v2.6.6

- **Edit Item heading** — the heading of the editor for an existing item now reads **Edit Item**, matching New Item and Delete Item. Service worker cache bumped to `todo-v2.6.6`.

## What's New in v2.6.5

- **Item wording, one create button** — the home heading now reads **Your TODOs**, the editor heading is **New Item**, its delete button is **Delete Item**, and the + button is labelled **New Item**. The large create button in empty states is gone from every view; the + button is the single way to add an item. Service worker cache bumped to `todo-v2.6.5`.

## What's New in v2.6.4

- **Cleaner sort bar** — removed the explanatory line under the Today and Scheduled sort controls. Those views still default to Due date / Soonest on top, and Settings still explains the default. Service worker cache bumped to `todo-v2.6.4`.

## What's New in v2.6.3

- **Dated views default to due date** — Today and Scheduled only show to-dos with a date, so they now fall back to **Due date / Soonest on top** regardless of the app-wide default. A short hint under the sort controls explains why, and any sorting you choose in those views still overrides the default.
- **Picking Due date selects Soonest on top** — changing Sort by to Due date in the sort bar or Settings automatically switches the order to Soonest on top. The order stays editable, so you can choose Latest on top afterwards. Service worker cache bumped to `todo-v2.6.3`.

## What's New in v2.6.2

- **Date added / Newest on top is the new default** — fresh installs and views without a saved sorting now start with the most recently added to-dos first. Due-date sorting is still available per list and view, and existing saved choices are unchanged. Service worker cache bumped to `todo-v2.6.2`.

## What's New in v2.6.1

- **Sorting now waits for Save** — the Settings Sorting group follows the same Save/Cancel rules as the rest of the sheet: change Sort by or Order and Save enables; Save applies the choice to every list and smart view, then closes. Cancel discards it. The instant "Apply this sorting to all lists" button is gone.
- **Clearer direction labels** — Ascending/Descending are replaced with field-aware wording: Soonest on top / Latest on top for due date, Oldest on top / Newest on top for date added, and A–Z / Z–A for name. Service worker cache bumped to `todo-v2.6.1`.

## What's New in v2.6.0

- **Sorting syncs across devices** — per-view sorting (each list and smart view's field + direction) now lives on the server in the settings store instead of only in browser storage, so every signed-in device shares the same choices. The first device to open after the upgrade offers its existing local choices as the seed; other devices adopt the shared sorting. A local copy still renders instantly and covers offline use: changes made offline are queued and pushed on the next successful load, ahead of anything from the server. Every write is a single-view intent merged into the stored sorting on the server inside one transaction, so a stale tab can only change the view you just touched and cannot wipe newer choices from another device. A second device picks up changes on its next refresh, not instantly. Theme and density stay device-specific. New session-only endpoint `POST /api/settings/sort` (one intent per call: a single view, an apply-all, or a first-device seed); the sorting data rides along in `GET /api/settings` and `GET /api/state`, so the load path gains no extra request. Service worker cache bumped to `todo-v2.6.0`.

## What's New in v2.5.0

- **Each list remembers its own sorting** — the Sort controls in a list or smart view now save the field (due date, date added, name) and direction for that view only, and the choice survives reloads. Views without their own choice fall back to the app default, which starts from the previous global sorting so nothing jumps on upgrade. Settings gains a **Sorting** group with a one-time "Apply to all lists" action that sets every list and view to the chosen sorting (lists are not linked afterwards — each can still pick its own). On the Scheduled view the same controls save a Scheduled-only choice that orders rows within each bucket; the chronological buckets themselves (and the pinned Overdue section) never change. The Home view is unchanged. Service worker cache bumped to `todo-v2.5.0`.

## What's New in v2.4.0

- **Scheduled groups by time bucket, not by date** — after the pinned Overdue section, upcoming to-dos now land in **Today**, **Tomorrow**, **This Week**, **Next Week**, **Later This Month** and **Later** headings instead of one heading per date. Each to-do appears once, in the first bucket it fits, and its row still shows the exact due date and time. Weeks run Monday to Sunday; buckets with nothing in them are hidden. The Today and Home views are unchanged. Service worker cache bumped to `todo-v2.4.0`.

## What's New in v2.3.6

- **Every sheet now matches** — the editor, list, notifications, time-zone and Settings sheets use the same thin 6px faint scrollbar as the reminders list, over a transparent track in both light and dark mode, instead of the OS default. Scrolling is unchanged. Service worker cache bumped to `todo-v2.3.6`.

## What's New in v2.3.5

- **Undo skip** — skipped occurrences in a recurring to-do's history now have an **Undo skip** action. It removes the skip record entirely (the skipped date disappears from history) and puts the occurrence back in play: if it sits before the series' current date, the series moves back to it and notifications re-arm; a later skipped occurrence simply comes up naturally when the series reaches it.
- **Thin, faint reminders-list scrollbar** — the list no longer shows the OS default scrollbar. It now uses a thin 6px thumb tinted from the theme's line colour (faint in both light and dark mode) over a transparent track, keeping a quiet position cue without spoiling the clean look. Scrolling is unchanged. Service worker cache bumped to `todo-v2.3.5`.

## What's New in v2.3.4

- **Save feedback is visible before the sheet closes** — Add, Save and the list editor now hold their **Adding...** / **Saving...** state for at least 0.7 s (or until the request finishes, whichever is longer), so a fast connection no longer makes the sheet vanish before you see confirmation.
- **List editor gets the same rules** — **Done** is now **Save**, disabled until you type a name for a new list or actually change the name/colour of an existing one; Unlisted enables on a colour change, and the button shows Saving... while it works.
- **Tighter header icons** — the refresh, ⋯ list-options and hamburger icons are now bare Scrawl-style glyphs with a 14px gap instead of 36–40px boxes, on both the Home and list headers. Service worker cache bumped to `todo-v2.3.4`.

## What's New in v2.3.3

- **Notes hold a full article** — the notes field now accepts up to 50,000 characters (roughly 8,000 words) on create, edit, occurrence overrides, import and backup. Long notes scroll inside the editor instead of stretching the sheet, list rows keep their 2-line preview, and the request body limit was raised so multi-note imports still work.
- **Add and Save tell you they registered** — the editor's header action starts disabled until the title has text (Add) or a field actually changes (Save), then swaps to **Adding...** / **Saving...** and disables itself while the request runs, restoring on failure. The Settings **Save** button does the same. Service worker cache bumped to `todo-v2.3.3`.

## What's New in v2.3.2

- **Cancel and Add live in the editor header** — adding a to-do now uses the same header pattern as Settings: Cancel on the left, the title in the middle, and a text **Add** on the right that stays visible while options are expanded. Editing uses the same pattern with **Save**. The oversized white Add pill under the title is gone; Enter still saves and Shift+Enter still adds a line.
- **More options is plain text** — the toggle no longer draws a hover/focus background (which was misaligned and stuck after tapping on a phone).
- **Date and time values are vertically centred** — the row is now the field and the native date/time control sits inside it, so the value no longer hugs the top of the box on iOS. Service worker cache bumped to `todo-v2.3.2`.

## What's New in v2.3.1

- **More snooze choices** — due items now offer Snooze 1 hour, 3 hours and 6 hours (plus Next occurrence on repeats). A snooze can run past midnight. Service worker cache bumped to `todo-v2.3.1`.

## What's New in v2.3.0

- **Quick add asks for a name and nothing else** — a new to-do opens with just the title field. Enter or the Add button saves it (Shift+Enter still adds a line); notes, date, time, repeat and list options stay tucked behind More options until you ask for them. Editing an existing to-do still shows everything.
- **Desktop cards use their width** — a reminder's Snooze and Reschedule actions sit compactly on the right of the card instead of stacking under the text, and rows are a touch clearer. Mobile keeps the stacked layout; row height, padding and Compact density are unchanged.
- **Fluid feedback** — new rows ease into place, the complete check pops as it fills, and More options expands smoothly. Nothing waits on an animation, and everything is still under Reduce Motion.
- **Skeleton loading** — while to-dos load, placeholder rows shaped like the real list show instead of a blank screen, and they are replaced the moment data arrives (no artificial delay). Service worker cache bumped to `todo-v2.3.0`.

## What's New in v2.2.1

- **Save in Settings now responds to theme and density** — these are per-device preferences, so Save used to stay disabled when only they changed, and Cancel was the only enabled button. Changing either now enables Save, which commits the choice and closes the sheet; Cancel, the backdrop, and Escape restore the appearance from when Settings opened. Theme buttons also trigger the same check now. Service worker cache bumped to `todo-v2.2.1`.

## What's New in v2.2.0

- **Quick-add clock times are correct in every time zone** — chrono resolved the parsed date lazily against the server's timezone after `/api/parse` restored it, so "at 5pm" landed hours late (and could roll into the next day). The instant is now captured while the device zone is pinned.
- **Search covers all history** — search is global, not scoped to the open list, and runs on the server so completed to-dos older than 30 days are included. Results are grouped Open then Completed, and each row shows its list.
- **Device-zone changes ask first** — opening the app in a new zone previews how many future floating to-dos would move, then asks before committing (per-zone dismissal) and offers Undo for 10 seconds. The stored zone is described honestly as the last zone a device confirmed. Service worker cache bumped to `todo-v2.2.0`.
- **Settings has Cancel + Save** — Save lives in the header and stays disabled until a server-backed field changes; theme and density still apply instantly. The confirmation now names what actually changed instead of always claiming "new to-dos only".
- **Clearer row actions and validation** — Snooze (1 hour / Next occurrence) and Reschedule (Today / Tomorrow) are separate labelled groups, a no-op Today is hidden, and empty titles/list names show an inline error. The More Options row is renamed "Time model".

## What's New in v2.1.0

- **List reordering is grip-only** — you can only drag a list to reorder it by its drag handle (the grip), or with the arrow keys while the grip is focused. Long-pressing a list row no longer starts a reorder, so tapping a row always opens that list. Service worker cache bumped to `todo-v2.1.0`.

## What's New in v2.0.0

- **Fully renamed to ToDo** — the old "remember" name is gone from the internals too: the npm package, the SQLite file (`data/todo.db`), session cookie (`todo.sid`), browser storage keys (`todo.*`), the service-worker cache (`todo-v2.0.0`), the exported backup filename (`todo-backup-*.json`), and notification tags. Old `remember`/`done` backup files still import. An existing `data/remember.db` is renamed to `todo.db` automatically on first boot, so no data is lost.
- Note: renaming the cookie and storage keys signs you out once and resets per-device UI preferences (sort, density, last list, completed toggle).

## What's New in v1.11.1

- **Aligned completed toggle + centred row check** — the per-list “Show/Hide N Completed” link now sits flush-left with the to-do cards and the Completed heading, with equal spacing above and below. On a title-only to-do (no note, link, or date), the complete circle is vertically centred in the row; rows with extra lines keep the circle on the title line. Service worker cache bumped to `remember-v1.11.1`.

## What's New in v1.11.0

- **Record dates** — the editor’s More Options shows read-only “Added” and “Completed on” timestamps for existing to-dos, and completed rows display when they were completed. Service worker cache bumped to `remember-v1.11.0`.

## What's New in v1.10.1

- **Balanced sort bar spacing** — the Sort/Order row now has equal 12px padding above and below, so it sits evenly between the search bar and the first to-do card. Service worker cache bumped to `remember-v1.10.1`.

## What's New in v1.10.0

- **Renamed to ToDo** — the app is now ToDo everywhere: tab title, Home wordmark, auth screen, manifest/PWA name, notification titles, and user-facing copy (“to-dos”, “New To-Do”). Existing backup files still import.
- **New stacked TO/DO icon** — a two-row Fraunces wordmark on the dark tile, matching the Spend Less / Invest More icon style. All favicon and PWA sizes are regenerated by `generate-icons.py` (`npm run icons`).
- **Empty lists keep their action** — showing completed to-dos no longer replaces the “Nothing here” state. Active rows stay put, the New To-Do button remains, and completed rows expand below.

## What's New in v1.9.1

- **Consistent control heights + bigger touch targets** — settings inputs/selects/buttons and the token-row controls all share one height (40px desktop, 44px phone); the token-row Access select gets an explicit height, box-model reset, and custom chevron so it renders exactly like the Change access/Revoke buttons next to it. Header icon buttons grow (36px desktop, 40px phone) and invisible hit pads expand taps to 44px on coarse pointers; nav rows, menu items, sort select, and segmented controls get 44px phone targets. Home/detail header geometry unchanged.

## What's New in v1.8.12

- **Narrower desktop column** — the centered app column is now 54vw (max 990px), 10% slimmer than before. Mobile unchanged.

## What's New in v1.8.11

- **One search bar** — Home and list-view search boxes now share a single identical spec (icon, padding, font, height), so the search bar no longer changes shape between screens.

## What's New in v1.8.10

- **Aligned Home columns** — wordmark, search box, and section text share one left edge; smart-view icons and list dots share an icon column; labels and list names share a text column.

## What's New in v1.8.9

- **Unified list title** — the list-view title is now the same 22px Fraunces cut as the Home wordmark, and the detail action icons are pinned to the top edge like Home's, so nothing shifts between screens.

## What's New in v1.8.8

- **Divider-free headers** — removed the divider under the list-view header (and the matching Home one), so the search bar sits directly beneath the header row with the same 10px rhythm on both screens.

## What's New in v1.8.7

- **Matching headers** — Home now has the same divider under the header row as the list view, and both screens share one background. Header, icons, and search stay frozen on every screen.

## What's New in v1.8.6

- **Single-scroll Home** — on mobile only the header and search bar stay frozen; smart views, My Lists, and all list rows scroll as one continuous page (no more nested list scroller).

## What's New in v1.8.5

- **Fixed header icons** — the refresh button now sits at the exact same coordinates on Home and inside a list, and the gaps between the list-options (⋯), refresh, and hamburger icons are a uniform 12px on every screen.

## What's New in v1.8.4

- **Renamed to Done!** — the app is now called Done! everywhere: tab title, Home wordmark, auth screen, manifest/PWA name, and notification titles. Old `remember`-marked backup files still import.
- **New Done! icon** — Fraunces “Done!” wordmark on the dark tile, matching the Spend Less / Invest More icon style (`generate-icons.py`, `icon-fonts/`).

## What's New in v1.8.3

- **Unlisted list** — a pinned gray system list that always sits first. It uses a lock instead of a drag handle and cannot be renamed, deleted, or reordered. New reminders added from Home or any smart view default to Unlisted; reminders added while inside a list default to that list.
- **Unified Home** — one full-width Home panel on web and mobile, with a centered 60vw desktop column (max 1100px), plain-text Sort/Order controls, visible drag grips, and a New List text button. The old sidebar/card-grid layout is gone.
- **Fixed menu position** — the hamburger now stays at the exact same top-right position on Home and inside a list; it no longer jumps to the left.
- **Self-hosted fonts** — Fraunces and Outfit are served from `/fonts` and precached by the service worker. No Google Fonts requests, so the display typography is identical on web/mobile and works offline.
- **Service worker** — cache bumped to `remember-v1.9.0`.

## What's New in v1.9.0

- **Token API profiles** — new tokens are **read-only** by default; **read + write** is an explicit opt-in with a warning in Settings. Tokens created before profiles keep exactly their old capabilities under a migration-only `legacy` profile, and the owner can upgrade any token (`legacy` → read/write, read ↔ write) from Settings — the only way a token's capability ever changes.

## Features

- Lists with a 15-color palette (new lists auto-pick the first unused color, then rotate), drag-to-reorder handles (pointer, touch, and keyboard), and a pinned Unlisted list that stays first.
- Reminders with title, notes, date, optional time, and an urgent flag. Notes render as a text row plus a separate row of compact link chips; bare domains like example.com work, and joining commas are not shown between chips.
- Recurring reminders (daily/weekly/monthly/yearly/custom) with per-occurrence completion history, skip with undo, a **Next occurrence** row action for due series, and this-occurrence-vs-series editing.
- Natural-language quick add: "call mom tomorrow 6pm" pre-fills the editor with a removable preview.
- Smart lists: Today (overdue pinned), Scheduled (overdue pinned, then Today / Tomorrow / This Week / Next Week / Later This Month / Later buckets, Monday-start weeks, exact due date on every row), All, Flagged (urgent), Completed.
- Time models: floating wall-clock (default; follows the device's last-synced zone) or zone-anchored (with a styled Time zone picker in the editor). The choice appears once an item has a clock time; date-only items just take a date. Settings has a default model and default zone; changing them affects new reminders only, never existing ones.
- Snooze (in-app button + notification actions where supported). Due rows group their actions under a clear **Snooze until** label: 1 hour, Today/Tomorrow, or Next occurrence for repeating reminders. Opt-in re-push with quiet hours.
- Token API so external agents can list, add, and complete reminders without a browser.
- Completed reminders remain visible for 30 days in the UI and `GET /api/state`; older records stay in SQLite and are still returned by `GET /api/reminders` (including the complete-snapshot mode). Per-list Show/Hide-completed choice is remembered.
- Deleting is inline (no browser dialogs): on touch, swipe any row left — including completed rows — to reveal the red Delete action (centered label), tap it once for “Confirm?”, tap again to delete; swipe right closes the reveal. On the web there is no swipe; hover the row and click the ×, then “Confirm?”. The card slides away when deleted.
- Search across active reminders.
- Desktop uses a centered 60vw column (max 1100px) with one Home panel; reminders fill the column with a fixed FAB. There is no permanent sidebar.
- Mobile home is a full-screen panel: search, Today/Scheduled/All/Flagged/Completed, My Lists, then the lists with drag/long-press reordering. The hamburger holds only Notifications, Settings, and Log out and stays at the same top-right position on Home and inside a list; back returns to the lists. Default time model on a phone is floating.
- Installable PWA with web push notifications. iOS requires 16.4+ and the app installed to the Home Screen.
- Single-user password auth, CSRF protection, rate-limited login, and secure session cookies behind HTTPS.
- Auto, light, and dark themes, plus comfortable/compact density.
- JSON backup download + merge-safe import in Settings.
- One SQLite database; easy to back up and move.

Urgent is a visual flag only: it marks the reminder in red but does not change notification timing or add an alarm.

### Time model differences

- **Floating** — stores a wall-clock time in the device's last-synced zone (“6pm wherever I am”). It re-syncs when the app opens in a new zone; the server cannot detect travel while the app is closed.
- **Anchored** — stores a wall-clock time in a named zone (“6pm Asia/Kolkata”) and keeps that zone's schedule regardless of the device.

The card shows “Floating” without a zone (the editor discloses the last synced zone) and “Anchored · zone” when a specific zone is the rule, and only once an item has a date. Changing the default model/zone in Settings only affects new reminders; the Settings sheet states this in a prominent notice and confirms it again after saving. Existing reminders are never migrated. Older backups may still contain Fixed items (one absolute instant, shown in the device zone); they fire as stored and open in the editor as Floating.

## Stack

- Node.js 20+ and Express 4
- SQLite via `sqlite3` (WAL mode, foreign keys on)
- Vanilla JavaScript PWA with a small hash router
- Self-hosted Outfit + Fraunces fonts (no external font CDN)
- `bcryptjs` + `express-session` for single-user auth
- `web-push` with VAPID keys generated on first boot
- `chrono-node` for natural-language date parsing (server-side)

## Run locally

```bash
npm install
npm start
```

Open http://127.0.0.1:3006. The first visit asks you to create a password (minimum 8 characters). There is no registration and no password recovery.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3006` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `DATA_DIR` | `./data` | SQLite directory |
| `CONTACT_EMAIL` | `your@email.com` | VAPID contact email; set your own |

Your data lives in `data/todo.db`. It is gitignored because it contains the password hash, VAPID private key, and all reminders.

## Project layout

```text
server.js                 Express app, auth, REST API, scheduler
db.js                     SQLite connection and migrations
session-store.js          SQLite-backed express-session store
recurrence.js             Repeat rules, time-zone math, occurrence scheduling
push.js                   Web Push / VAPID setup
public/index.html         App shell and SVG icons
public/app.js             Hash router, rendering, editor, drag reorder
public/styles.css         Theme tokens and responsive layout
public/sw.js              Service worker / offline shell / push handlers
public/manifest.webmanifest
scripts/generate-icons.js Regenerates the PNG icons (`npm run icons`)
data/                     Local SQLite files (gitignored)
```

## API outline

Public: `GET /api/health`, `GET /api/session`, `POST /api/setup`, `POST /api/login`.

Authenticated routes require the `todo.sid` session cookie. State-changing requests also require the `X-CSRF-Token` header returned by `GET /api/session`.

- `GET /api/state` (lists, reminders, non-secret settings)
- `GET /api/settings`, `POST /api/settings` (allowlisted keys only)
- `POST /api/settings/sort` (synced per-view sorting; one intent per call - single view, apply-all, or first-device seed - merged server-side)
- `POST` / `PATCH` / `DELETE /api/lists[/:id]`
- `PUT /api/lists/order`
- `POST /api/reminders`, `PATCH` / `DELETE /api/reminders/:id`
- `POST /api/reminders/:id/skip|unskip|snooze|reschedule`, `GET /api/reminders/:id/occurrences`
- `POST /api/parse` (natural-language title parsing)
- `GET /api/lists`, `GET /api/reminders` (also usable with a token)
- `GET /api/tokens`, `POST /api/tokens`, `POST /api/tokens/:id/revoke`
- `GET /api/export`, `POST /api/import`
- `POST /api/push/subscribe`, `/unsubscribe`, `/test`, `/action` (signed notification actions)
- `POST /api/password`
- `POST /api/logout`

Personal access tokens (`Authorization: Bearer $TEST_TOKEN`, created in Settings) come in three profiles. A bad bearer is rejected with `401` on every `/api` route; token responses are never cached (`Cache-Control: no-store`); use tokens only over HTTPS — they are bearer secrets.

- **read** (default for new tokens): `GET /lists`, `/reminders`, `/reminders/:id`, `/reminders/:id/occurrences`, `/state`, plus `POST /parse` (read-only natural-language date parsing, same engine as the editor).
- **write**: everything in read, plus idempotent `POST /reminders`, full-edit `PATCH /reminders/:id`, and `POST /reminders/:id/snooze|skip|reschedule`. Every write-profile mutation REQUIRES an `Idempotency-Key` header (1–200 chars) and `base_revision` + `base_epoch` (see below).
- **legacy** (migration-only, never selectable): exactly the pre-profile capabilities — reads, key-optional creates, and complete-only PATCH.

`GET /api/tokens` shows each token's profile (never hashes); the owner changes profiles in Settings (`POST /api/tokens/:id/profile`, session-only). Deleting reminders, managing lists, settings, token management, import/export, password, and push stay session-only for every profile.

**Write-protocol (write profile only).** First execution of every mutation needs `base_revision` (integer) and `base_epoch` (string); missing or wrongly typed → `400`. The server checks `base_epoch` against its `store_epoch` setting (regenerated on every backup import, nowhere else) → mismatch is `409 {"error": "Store was restored since your read"}` — never bypassed. Mutations apply as one atomic compare-and-write (`revision = revision + 1` in the same statement); a stale base → `409 {"error": "Reminder changed since your read", "reminder": <current row>}`. Replays (same key + byte-identical body) return `200 {"deduplicated": true, "original_status", "result"}` where `result` is the FROZEN first-execution outcome (historical — follow up with `GET /api/reminders/:id` for current state); a retried snooze keeps its original absolute time, never recomputed. Same key with a different raw payload → `409`. Keys are namespaced per token and per concrete route, survive reminder deletion (replay then adds `"deleted": true`), and the fingerprint covers the raw request only — resolved defaults and server-computed targets are frozen at first execution, so replaying the same raw request is stable across Settings changes, list renames, and clock moves. Token bodies are strictly validated (unknown fields and wrong types → `400` naming the field); session callers keep their lenient behavior.

**Recurring series (write profile).** `PATCH {"completed": true}` and `POST …/skip` on a recurring reminder must include `occurrence_at`. If it equals the current `due_at`, the operation proceeds (same-occurrence duplicates are harmless). If it differs and that occurrence is already recorded done, the server answers `200 {"ok": true, "alreadyDone": true}` without advancing again (this recognition bypasses only the revision check, never the epoch guard). Otherwise → `409 {"error": "Stale occurrence", "currentDue"}`.

**Change tracking.** Every reminder carries `revision` (monotonic integer, bumped by every content/state mutation including UI edits and occurrence-scope edits — never by push bookkeeping) and `updated_at`/`notified_at`. `GET /api/reminders` with NO filters returns the COMPLETE snapshot (every row, `ORDER BY id`, `complete: true`, top-level `store_epoch`): diff two snapshots by `id` to see everything, including hand edits from the UI. Only absence from that unfiltered snapshot implies deletion; filtered/limited responses are convenience reads, not change signals. No cursors, no feeds, no polling promises.

**Agent conduct.** A token profile is technical capability, not permission: only create, edit, complete, or snooze reminders the owner has explicitly instructed, and never invent operations on their own.

## Deployment

Run the app behind an HTTPS reverse proxy (nginx or Caddy) and keep it alive with PM2 or systemd. Web push requires HTTPS.

```bash
npm install
npm start
```

- Proxy to `127.0.0.1:3006` and pass `X-Forwarded-Proto`.
- Set `trust proxy` (already enabled in `server.js`) so secure cookies work behind the proxy.
- Back up `data/todo.db` regularly.
- Never commit `data/` or replace the database with a fresh copy during an update.

Sessions are stored in SQLite, so refreshing the page or restarting the process keeps you signed in. The session secret and VAPID keys persist in the `settings` table.

## Version

2.7.6

## License

UNLICENSED
