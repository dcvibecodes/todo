# ToDo

A self-hosted, single-user task app in the spirit of Apple Reminders. Lists, due dates, urgent flags, recurring reminders, natural-language quick add, smart lists, floating time zones, a token API for external agents, completed history, dark mode, and web push. No frontend framework and no build step.

## What's New in v2.7.0

- **List progress in the sidebar** â each list can now show its open to-dos against its completed ones. The default **Bar with counts** draws a thin bar under the list name (the coloured part is what's done) with an "N open Â· M done" line; **Ring on the dot** puts the same ratio as a ring around the list's coloured dot; **Off** keeps the previous look. A second choice picks what the counts cover: **All completed to-dos** (default) or **Completed in the last 30 days**. Completed means finished items still in the list; a repeating to-do counts as open while its next occurrence is pending. Both choices live in Settings under Appearance and are device-specific, like theme and density. The Completed view is unchanged. Service worker cache bumped to `todo-v2.7.0`.

## What's New in v2.6.6

- **Edit Item heading** â the heading of the editor for an existing item now reads **Edit Item**, matching New Item and Delete Item. Service worker cache bumped to `todo-v2.6.6`.

## What's New in v2.6.5

- **Item wording, one create button** â the home heading now reads **Your TODOs**, the editor heading is **New Item**, its delete button is **Delete Item**, and the + button is labelled **New Item**. The large create button in empty states is gone from every view; the + button is the single way to add an item. Service worker cache bumped to `todo-v2.6.5`.

## What's New in v2.6.4

- **Cleaner sort bar** â removed the explanatory line under the Today and Scheduled sort controls. Those views still default to Due date / Soonest on top, and Settings still explains the default. Service worker cache bumped to `todo-v2.6.4`.

## What's New in v2.6.3

- **Dated views default to due date** â Today and Scheduled only show to-dos with a date, so they now fall back to **Due date / Soonest on top** regardless of the app-wide default. A short hint under the sort controls explains why, and any sorting you choose in those views still overrides the default.
- **Picking Due date selects Soonest on top** â changing Sort by to Due date in the sort bar or Settings automatically switches the order to Soonest on top. The order stays editable, so you can choose Latest on top afterwards. Service worker cache bumped to `todo-v2.6.3`.

## What's New in v2.6.2

- **Date added / Newest on top is the new default** â fresh installs and views without a saved sorting now start with the most recently added to-dos first. Due-date sorting is still available per list and view, and existing saved choices are unchanged. Service worker cache bumped to `todo-v2.6.2`.

## What's New in v2.6.1

- **Sorting now waits for Save** â the Settings Sorting group follows the same Save/Cancel rules as the rest of the sheet: change Sort by or Order and Save enables; Save applies the choice to every list and smart view, then closes. Cancel discards it. The instant "Apply this sorting to all lists" button is gone.
- **Clearer direction labels** â Ascending/Descending are replaced with field-aware wording: Soonest on top / Latest on top for due date, Oldest on top / Newest on top for date added, and AâZ / ZâA for name. Service worker cache bumped to `todo-v2.6.1`.

## What's New in v2.6.0

- **Sorting syncs across devices** â per-view sorting (each list and smart view's field + direction) now lives on the server in the settings store instead of only in browser storage, so every signed-in device shares the same choices. The first device to open after the upgrade offers its existing local choices as the seed; other devices adopt the shared sorting. A local copy still renders instantly and covers offline use: changes made offline are queued and pushed on the next successful load, ahead of anything from the server. Every write is a single-view intent merged into the stored sorting on the server inside one transaction, so a stale tab can only change the view you just touched and cannot wipe newer choices from another device. A second device picks up changes on its next refresh, not instantly. Theme and density stay device-specific. New session-only endpoint `POST /api/settings/sort` (one intent per call: a single view, an apply-all, or a first-device seed); the sorting data rides along in `GET /api/settings` and `GET /api/state`, so the load path gains no extra request. Service worker cache bumped to `todo-v2.6.0`.

## What's New in v2.5.0

- **Each list remembers its own sorting** â the Sort controls in a list or smart view now save the field (due date, date added, name) and direction for that view only, and the choice survives reloads. Views without their own choice fall back to the app default, which starts from the previous global sorting so nothing jumps on upgrade. Settings gains a **Sorting** group with a one-time "Apply to all lists" action that sets every list and view to the chosen sorting (lists are not linked afterwards â each can still pick its own). On the Scheduled view the same controls save a Scheduled-only choice that orders rows within each bucket; the chronological buckets themselves (and the pinned Overdue section) never change. The Home view is unchanged. Service worker cache bumped to `todo-v2.5.0`.

## What's New in v2.4.0

- **Scheduled groups by time bucket, not by date** â after the pinned Overdue section, upcoming to-dos now land in **Today**, **Tomorrow**, **This Week**, **Next Week**, **Later This Month** and **Later** headings instead of one heading per date. Each to-do appears once, in the first bucket it fits, and its row still shows the exact due date and time. Weeks run Monday to Sunday; buckets with nothing in them are hidden. The Today and Home views are unchanged. Service worker cache bumped to `todo-v2.4.0`.

## What's New in v2.3.6

- **Every sheet now matches** â the editor, list, notifications, time-zone and Settings sheets use the same thin 6px faint scrollbar as the reminders list, over a transparent track in both light and dark mode, instead of the OS default. Scrolling is unchanged. Service worker cache bumped to `todo-v2.3.6`.

## What's New in v2.3.5

- **Undo skip** â skipped occurrences in a recurring to-do's history now have an **Undo skip** action. It removes the skip record entirely (the skipped date disappears from history) and puts the occurrence back in play: if it sits before the series' current date, the series moves back to it and notifications re-arm; a later skipped occurrence simply comes up naturally when the series reaches it.
- **Thin, faint reminders-list scrollbar** â the list no longer shows the OS default scrollbar. It now uses a thin 6px thumb tinted from the theme's line colour (faint in both light and dark mode) over a transparent track, keeping a quiet position cue without spoiling the clean look. Scrolling is unchanged. Service worker cache bumped to `todo-v2.3.5`.

## What's New in v2.3.4

- **Save feedback is visible before the sheet closes** â Add, Save and the list editor now hold their **Adding...** / **Saving...** state for at least 0.7 s (or until the request finishes, whichever is longer), so a fast connection no longer makes the sheet vanish before you see confirmation.
- **List editor gets the same rules** â **Done** is now **Save**, disabled until you type a name for a new list or actually change the name/colour of an existing one; Unlisted enables on a colour change, and the button shows Saving... while it works.
- **Tighter header icons** â the refresh, â¯ list-options and hamburger icons are now bare Scrawl-style glyphs with a 14px gap instead of 36â40px boxes, on both the Home and list headers. Service worker cache bumped to `todo-v2.3.4`.

## What's New in v2.3.3

- **Notes hold a full article** â the notes field now accepts up to 50,000 characters (roughly 8,000 words) on create, edit, occurrence overrides, import and backup. Long notes scroll inside the editor instead of stretching the sheet, list rows keep their 2-line preview, and the request body limit was raised so multi-note imports still work.
- **Add and Save tell you they registered** â the editor's header action starts disabled until the title has text (Add) or a field actually changes (Save), then swaps to **Adding...** / **Saving...** and disables itself while the request runs, restoring on failure. The Settings **Save** button does the same. Service worker cache bumped to `todo-v2.3.3`.

## What's New in v2.3.2

- **Cancel and Add live in the editor header** â adding a to-do now uses the same header pattern as Settings: Cancel on the left, the title in the middle, and a text **Add** on the right that stays visible while options are expanded. Editing uses the same pattern with **Save**. The oversized white Add pill under the title is gone; Enter still saves and Shift+Enter still adds a line.
- **More options is plain text** â the toggle no longer draws a hover/focus background (which was misaligned and stuck after tapping on a phone).
- **Date and time values are vertically centred** â the row is now the field and the native date/time control sits inside it, so the value no longer hugs the top of the box on iOS. Service worker cache bumped to `todo-v2.3.2`.

## What's New in v2.3.1

- **More snooze choices** â due items now offer Snooze 1 hour, 3 hours and 6 hours (plus Next occurrence on repeats). A snooze can run past midnight. Service worker cache bumped to `todo-v2.3.1`.

## What's New in v2.3.0

- **Quick add asks for a name and nothing else** â a new to-do opens with just the title field. Enter or the Add button saves it (Shift+Enter still adds a line); notes, date, time, repeat and list options stay tucked behind More options until you ask for them. Editing an existing to-do still shows everything.
- **Desktop cards use their width** â a reminder's Snooze and Reschedule actions sit compactly on the right of the card instead of stacking under the text, and rows are a touch clearer. Mobile keeps the stacked layout; row height, padding and Compact density are unchanged.
- **Fluid feedback** â new rows ease into place, the complete check pops as it fills, and More options expands smoothly. Nothing waits on an animation, and everything is still under Reduce Motion.
- **Skeleton loading** â while to-dos load, placeholder rows shaped like the real list show instead of a blank screen, and they are replaced the moment data arrives (no artificial delay). Service worker cache bumped to `todo-v2.3.0`.

## What's New in v2.2.1

- **Save in Settings now responds to theme and density** â these are per-device preferences, so Save used to stay disabled when only they changed, and Cancel was the only enabled button. Changing either now enables Save, which commits the choice and closes the sheet; Cancel, the backdrop, and Escape restore the appearance from when Settings opened. Theme buttons also trigger the same check now. Service worker cache bumped to `todo-v2.2.1`.

## What's New in v2.2.0

- **Quick-add clock times are correct in every time zone** â chrono resolved the parsed date lazily against the server's timezone after `/api/parse` restored it, so "at 5pm" landed hours late (and could roll into the next day). The instant is now captured while the device zone is pinned.
- **Search covers all history** â search is global, not scoped to the open list, and runs on the server so completed to-dos older than 30 days are included. Results are grouped Open then Completed, and each row shows its list.
- **Device-zone changes ask first** â opening the app in a new zone previews how many future floating to-dos would move, then asks before committing (per-zone dismissal) and offers Undo for 10 seconds. The stored zone is described honestly as the last zone a device confirmed. Service worker cache bumped to `todo-v2.2.0`.
- **Settings has Cancel + Save** â Save lives in the header and stays disabled until a server-backed field changes; theme and density still apply instantly. The confirmation now names what actually changed instead of always claiming "new to-dos only".
- **Clearer row actions and validation** â Snooze (1 hour / Next occurrence) and Reschedule (Today / Tomorrow) are separate labelled groups, a no-op Today is hidden, and empty titles/list names show an inline error. The More Options row is renamed "Time model".

## What's New in v2.1.0

- **List reordering is grip-only** â you can only drag a list to reorder it by its drag handle (the grip), or with the arrow keys while the grip is focused. Long-pressing a list row no longer starts a reorder, so tapping a row always opens that list. Service worker cache bumped to `todo-v2.1.0`.

## What's New in v2.0.0

- **Fully renamed to ToDo** â the old "remember" name is gone from the internals too: the npm package, the SQLite file (`data/todo.db`), session cookie (`todo.sid`), browser storage keys (`todo.*`), the service-worker cache (`todo-v2.0.0`), the exported backup filename (`todo-backup-*.json`), and notification tags. Old `remember`/`done` backup files still import. An existing `data/remember.db` is renamed to `todo.db` automatically on first boot, so no data is lost.
- Note: renaming the cookie and storage keys signs you out once and resets per-device UI preferences (sort, density, last list, completed toggle).

## What's New in v1.11.1

- **Aligned completed toggle + centred row check** â the per-list âShow/Hide N Completedâ link now sits flush-left with the to-do cards and the Completed heading, with equal spacing above and below. On a title-only to-do (no note, link, or date), the complete circle is vertically centred in the row; rows with extra lines keep the circle on the title line. Service worker cache bumped to `remember-v1.11.1`.

## What's New in v1.11.0

- **Record dates** â the editorâs More Options shows read-only âAddedâ and âCompleted onâ timestamps for existing to-dos, and completed rows display when they were completed. Service worker cache bumped to `remember-v1.11.0`.

## What's New in v1.10.1

- **Balanced sort bar spacing** â the Sort/Order row now has equal 12px padding above and below, so it sits evenly between the search bar and the first to-do card. Service worker cache bumped to `remember-v1.10.1`.

## What's New in v1.10.0

- **Renamed to ToDo** â the app is now ToDo everywhere: tab title, Home wordmark, auth screen, manifest/PWA name, notification titles, and user-facing copy (âto-dosâ, âNew To-Doâ). Existing backup files still import.
- **New stacked TO/DO icon** â a two-row Fraunces wordmark on the dark tile, matching the Spend Less / Invest More icon style. All favicon and PWA sizes are regenerated by `generate-icons.py` (`npm run icons`).
- **Empty lists keep their action** â showing completed to-dos no longer replaces the âNothing hereâ state. Active rows stay put, the New To-Do button remains, and completed rows expand below.

## What's New in v1.9.1

- **Consistent control heights + bigger touch targets** â settings inputs/selects/buttons and the token-row controls all share one height (40px desktop, 44px phone); the token-row Access select gets an explicit height, box-model reset, and custom chevron so it renders exactly like the Change access/Revoke buttons next to it. Header icon buttons grow (36px desktop, 40px phone) and invisible hit pads expand taps to 44px on coarse pointers; nav rows, menu items, sort select, and segmented controls get 44px phone targets. Home/detail header geometry unchanged.

## What's New in v1.8.12

- **Narrower desktop column** â the centered app column is now 54vw (max 990px), 10% slimmer than before. Mobile unchanged.

## What's New in v1.8.11

- **One search bar** â Home and list-view search boxes now share a single identical spec (icon, padding, font, height), so the search bar no longer changes shape between screens.

## What's New in v1.8.10

- **Aligned Home columns** â wordmark, search box, and section text share one left edge; smart-view icons and list dots share an icon column; labels and list names share a text column.

## What's New in v1.8.9

- **Unified list title** â the list-view title is now the same 22px Fraunces cut as the Home wordmark, and the detail action icons are pinned to the top edge like Home's, so nothing shifts between screens.

## What's New in v1.8.8

- **Divider-free headers** â removed the divider under the list-view header (and the matching Home one), so the search bar sits directly beneath the header row with the same 10px rhythm on both screens.

## What's New in v1.8.7

- **Matching headers** â Home now has the same divider under the header row as the list view, and both screens share one background. Header, icons, and search stay frozen on every screen.

## What's New in v1.8.6

- **Single-scroll Home** â on mobile only the header and search bar stay frozen; smart views, My Lists, and all list rows scroll as one continuous page (no more nested list scroller).

## What's New in v1.8.5

- **Fixed header icons** â the refresh button now sits at the exact same coordinates on Home and inside a list, and the gaps between the list-options (â¯), refresh, and hamburger icons are a uniform 12px on every screen.

## What's New in v1.8.4

- **Renamed to Done!** â the app is now called Done! everywhere: tab title, Home wordmark, auth screen, manifest/PWA name, and notification titles. Old `remember`-marked backup files still import.
- **New Done! icon** â Fraunces âDone!â wordmark on the dark tile, matching the Spend Less / Invest More icon style (`generate-icons.py`, `icon-fonts/`).

## What's New in v1.8.3

- **Unlisted list** â a pinned gray system list that always sits first. It uses a lock instead of a drag handle and cannot be renamed, deleted, or reordered. New reminders added from Home or any smart view default to Unlisted; reminders added while inside a list default to that list.
- **Unified Home** â one full-width Home panel on web and mobile, with a centered 60vw desktop column (max 1100px), plain-text Sort/Order controls, visible drag grips, and a New List text button. The old sidebar/card-grid layout is gone.
- **Fixed menu position** â the hamburger now stays at the exact same top-right position on Home and inside a list; it no longer jumps to the left.
- **Self-hosted fonts** â Fraunces and Outfit are served from `/fonts` and precached by the service worker. No Google Fonts requests, so the display typography is identical on web/mobile and works offline.
- **Service worker** â cache bumped to `remember-v1.9.0`.

## What's New in v1.9.0

- **Token API profiles** â new tokens are **read-only** by default; **read + write** is an explicit opt-in with a warning in Settings. Tokens created before profiles keep exactly their old capabilities under a migration-only `legacy` profile, and the owner can upgrade any token (`legacy` â read/write, read â write) from Settings â the only way a token's capability ever changes.

## Features

- Lists with a 15-color palette (new lists auto-pick the first unused color, then rotate), drag-to-reorder handles (pointer, touch, and keyboard), and a pinned Unlisted list that stays first.
- Reminders with title, notes, date, optional time, and an urgent flag. Notes render as a text row plus a separate row of compact link chips; bare domains like example.com work, and joining commas are not shown between chips.
- Recurring reminders (daily/weekly/monthly/yearly/custom) with per-occurrence completion history, skip with undo, a **Next occurrence** row action for due series, and this-occurrence-vs-series editing.
- Natural-language quick add: "call mom tomorrow 6pm" pre-fills the editor with a removable preview.
- Smart lists: Today (overdue pinned), Scheduled (overdue pinned, then Today / Tomorrow / This Week / Next Week / Later This Month / Later buckets, Monday-start weeks, exact due date on every row), All, Flagged (urgent), Completed.
- Time models: fixed instant, floating wall-clock (default; follows the device's last-synced zone), or zone-anchored (with a styled Time zone picker in the editor). Settings has a default model and default zone; changing them affects new reminders only, never existing ones.
- Snooze (in-app button + notification actions where supported). Due rows group their actions under a clear **Snooze until** label: 1 hour, Today/Tomorrow, or Next occurrence for repeating reminders. Opt-in re-push with quiet hours.
- Token API so external agents can list, add, and complete reminders without a browser.
- Completed reminders remain visible for 30 days in the UI and `GET /api/state`; older records stay in SQLite and are still returned by `GET /api/reminders` (including the complete-snapshot mode). Per-list Show/Hide-completed choice is remembered.
- Deleting is inline (no browser dialogs): on touch, swipe any row left â including completed rows â to reveal the red Delete action (centered label), tap it once for âConfirm?â, tap again to delete; swipe right closes the reveal. On the web there is no swipe; hover the row and click the Ã, then âConfirm?â. The card slides away when deleted.
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

- **Fixed** â stores one absolute instant. It fires at the same moment everywhere; the clock time shown changes with the device zone.
- **Floating** â stores a wall-clock time in the device's last-synced zone (â6pm wherever I amâ). It re-syncs when the app opens in a new zone; the server cannot detect travel while the app is closed.
- **Anchored** â stores a wall-clock time in a named zone (â6pm Asia/Kolkataâ) and keeps that zone's schedule regardless of the device.

The card shows âFloatingâ without a zone (the editor discloses the last synced zone) and âAnchored Â· zoneâ when a specific zone is the rule. Changing the default model/zone in Settings only affects new reminders; the Settings sheet states this in a prominent notice and confirms it again after saving. Existing reminders are never migrated.

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

Personal access tokens (`Authorization: Bearer $TEST_TOKEN`, created in Settings) come in three profiles. A bad bearer is rejected with `401` on every `/api` route; token responses are never cached (`Cache-Control: no-store`); use tokens only over HTTPS â they are bearer secrets.

- **read** (default for new tokens): `GET /lists`, `/reminders`, `/reminders/:id`, `/reminders/:id/occurrences`, `/state`, plus `POST /parse` (read-only natural-language date parsing, same engine as the editor).
- **write**: everything in read, plus idempotent `POST /reminders`, full-edit `PATCH /reminders/:id`, and `POST /reminders/:id/snooze|skip|reschedule`. Every write-profile mutation REQUIRES an `Idempotency-Key` header (1â200 chars) and `base_revision` + `base_epoch` (see below).
- **legacy** (migration-only, never selectable): exactly the pre-profile capabilities â reads, key-optional creates, and complete-only PATCH.

`GET /api/tokens` shows each token's profile (never hashes); the owner changes profiles in Settings (`POST /api/tokens/:id/profile`, session-only). Deleting reminders, managing lists, settings, token management, import/export, password, and push stay session-only for every profile.

**Write-protocol (write profile only).** First execution of every mutation needs `base_revision` (integer) and `base_epoch` (string); missing or wrongly typed â `400`. The server checks `base_epoch` against its `store_epoch` setting (regenerated on every backup import, nowhere else) â mismatch is `409 {"error": "Store was restored since your read"}` â never bypassed. Mutations apply as one atomic compare-and-write (`revision = revision + 1` in the same statement); a stale base â `409 {"error": "Reminder changed since your read", "reminder": <current row>}`. Replays (same key + byte-identical body) return `200 {"deduplicated": true, "original_status", "result"}` where `result` is the FROZEN first-execution outcome (historical â follow up with `GET /api/reminders/:id` for current state); a retried snooze keeps its original absolute time, never recomputed. Same key with a different raw payload â `409`. Keys are namespaced per token and per concrete route, survive reminder deletion (replay then adds `"deleted": true`), and the fingerprint covers the raw request only â resolved defaults and server-computed targets are frozen at first execution, so replaying the same raw request is stable across Settings changes, list renames, and clock moves. Token bodies are strictly validated (unknown fields and wrong types â `400` naming the field); session callers keep their lenient behavior.

**Recurring series (write profile).** `PATCH {"completed": true}` and `POST â¦/skip` on a recurring reminder must include `occurrence_at`. If it equals the current `due_at`, the operation proceeds (same-occurrence duplicates are harmless). If it differs and that occurrence is already recorded done, the server answers `200 {"ok": true, "alreadyDone": true}` without advancing again (this recognition bypasses only the revision check, never the epoch guard). Otherwise â `409 {"error": "Stale occurrence", "currentDue"}`.

**Change tracking.** Every reminder carries `revision` (monotonic integer, bumped by every content/state mutation including UI edits and occurrence-scope edits â never by push bookkeeping) and `updated_at`/`notified_at`. `GET /api/reminders` with NO filters returns the COMPLETE snapshot (every row, `ORDER BY id`, `complete: true`, top-level `store_epoch`): diff two snapshots by `id` to see everything, including hand edits from the UI. Only absence from that unfiltered snapshot implies deletion; filtered/limited responses are convenience reads, not change signals. No cursors, no feeds, no polling promises.

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

2.6.6

## License

UNLICENSED
