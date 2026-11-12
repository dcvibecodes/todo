# Workspace

A self-hosted, single-user app with three tenants — Reminders, Notes and Docs — each organised with folders. Reminders adds due dates, urgent flags, recurring reminders, natural-language quick add, smart views, floating time zones, a token API for external agents, completed history, dark mode, and web push. Notes and Docs add file attachments and local document storage. No frontend framework and no build step.

## What's New in v4.8.2

- **Stored size is the visible size** - Docs cards now show the actual `stored_size` (for example 436.7 KB), not the larger pre-optimization upload. The File sheet repeats the stored size and explains the uploaded size when they differ. Storage totals already use stored bytes.
- **Uniform file actions** - Share file and Download now use identical height, width, padding, font, icon size and alignment.
- Service worker cache bumped to `workspace-v4.8.2`.

## What's New in v4.8.1

- **Fix iPhone `.jpeg` uploads** - iOS Photos often returns an iPhone image as `IMG_xxxx.jpeg` even when the source is HEIC. The Docs picker was rejecting that extension before upload. Docs now accepts `.jpeg` as a normal JPEG alias (20 formats); HEIC/HEIF still convert to JPG.
- Service worker cache bumped to `workspace-v4.8.1`.

## What's New in v4.8.0

- **Docs added dates** - every Docs card now shows an `Added` date from the stored upload time, and the File sheet shows the exact local date/time. Renaming or moving a file does not change it.
- **Image thumbnails on reminder and note cards** - outer cards show real image thumbnails that open the full-screen preview; repeated per-image download icons are gone. Each file keeps a labelled download action inside the opened reminder/note, and non-image chips stay as they were.
- **Explicit upload policy** - Settings → Uploads adds an "Optimize new images and PDFs" switch (on by default). Turning it off keeps new originals untouched for signed, medical, archival or metadata-sensitive files. The File sheet shows original vs stored size and what Download returns; text gzip remains lossless and always on.
- **Honest collection snapshots** - `GET /api/notes` and `GET /api/docs` now return the whole authorized collection when `limit` is omitted. An explicit `limit` returns `complete: false`/`has_more: true` when truncated, plus `total` and a `scope` object; the old silent 100-row cap is gone.
- **Upload diagnostics and proxy errors** - compression logs distinguish optimized, kept, skipped, unavailable, error and disabled outcomes. Every response carries an `X-Request-Id` header; upload/server errors also include it in the JSON body, and the client turns proxy HTML pages into a clear size/timeout message.
- **File export** - Docs cards are draggable on fine-pointer desktops using Chromium's `DownloadURL` (best effort), and the File sheet has a Share file action that packages the authenticated bytes into a `File` for the Web Share API where supported. Download remains the fallback; no private link or token is exposed.
- **HEIC/HEIF support** - iPhone HEIC/HEIF images are accepted in Docs, reminders and notes, converted to JPG with ImageMagick, and then preview/download as normal JPG. Unsupported Docs file types now fail immediately in the picker before any upload starts. Docs accepts `.jpg`, `.jpeg`, `.heic` and `.heif` for iPhone uploads (Docs advertises 20 formats).
- **Preview polish** - the image viewer has a loading/error state and no longer closes itself on a failed preview. Image thumbnails fall back to an icon on errors.
- Service worker cache bumped to `workspace-v4.8.0`.

## What's New in v4.7.1

- **Image compression on the VPS** - image optimization now uses ImageMagick instead of the sharp native module, whose prebuilt binary requires an x86-64-v2 CPU and could not load on the VPS. JPEG/PNG/WebP/GIF compression, resizing and animation preservation are unchanged; BMP files stay uncompressed.
- Service worker cache bumped to `workspace-v4.7.1`.

## What's New in v4.7.0

- **Image previews everywhere** - Docs images show an inline preview in the File sheet and open a full-screen viewer; reminder and note image attachments get a separate Preview action alongside Download. Supported preview images are PNG, JPG/JPEG, GIF, WebP and BMP. Preview responses are authenticated, parent-authorized, image-only, `inline`, `private, no-store` and `nosniff`; downloads stay separate attachment responses.
- **Upload compression everywhere** - uploaded images, PDFs and text-like files are optimized before storage in Docs, reminders and notes. Images are auto-oriented, capped at 2400 px on the long edge and re-encoded with ImageMagick (JPEG quality 82, PNG 256-colour quality 90, WebP quality 82, animated GIF/WebP preserved). PDFs are rewritten with Ghostscript's `/ebook` profile (150 dpi images). Text-like files are gzip-compressed at rest and decompressed for download. A compressed version is kept only when it is smaller; filename and MIME type stay the same. Optimized images/PDFs download as the optimized bytes, while gzip text downloads as the exact original. ZIP/Office and BMP files are left as-is; existing uploads are not reprocessed.
- Service worker cache bumped to `workspace-v4.7.0`.

## What's New in v4.6.1

- **Full file name in the File sheet** - the rename field is now an auto-growing, wrapping textarea, so long document names are fully visible instead of silently clipped. Enter is suppressed so names stay single-field values.
- Service worker cache bumped to `workspace-v4.6.1`.

## What's New in v4.6.0

- **Rename Docs files** - the File sheet name is now editable. Save is enabled only when the name or folder changes, and the new name is used by the list, file sheet and download response. The original extension must be kept; changing to another extension is rejected.
- **Token rename support** - `PATCH /api/docs/:id` accepts `name` alongside `folder_id`, with the existing idempotency, revision and store-epoch guards.
- Service worker cache bumped to `workspace-v4.6.0`.

## What's New in v4.5.6

- **Collapsible Note options** - the Note editor now keeps Folder and Attachments behind a minimal **More options** chevron, matching the reminder editor. It starts collapsed; Delete Note remains visible.
- Service worker cache bumped to `workspace-v4.5.6`.

## What's New in v4.5.5

- **Simpler Docs cards** - removed the redundant file-type label; the extension already identifies the type. File size and the download icon now sit together on the right on desktop and mobile, matching the copy/edit action position in other tenants. The download icon uses the same 34px size, opacity and hover treatment as copy/edit.
- Service worker cache bumped to `workspace-v4.5.5`.

## What's New in v4.5.4

- **Docs empty state lists every format inline** - the “No files yet” state now shows one centred sentence with the category summary and the full extension list. The expandable All formats dropdown is gone.
- Service worker cache bumped to `workspace-v4.5.4`.

## What's New in v4.5.3

- **Removed UI caveat copy** - the Docs empty-state format list now shows only the supported-format summary and extension list. Preview/scanning/download explanations stay in the README. Reminder and note attachment hints now show only “Any file type, up to 25 MB each.”
- Service worker cache bumped to `workspace-v4.5.3`.

## What's New in v4.5.2

- **Centred Docs format help** - the category summary, “All formats” expander, extension list and caveat are now centred inside the empty state.
- Service worker cache bumped to `workspace-v4.5.2`.

## What's New in v4.5.1

- **Docs format help only when empty** - the supported-format summary and expandable full list now appear inside the “No files yet” state instead of above every Docs list.
- Service worker cache bumped to `workspace-v4.5.1`.

## What's New in v4.5.0

- **More standalone Docs formats** - Docs now accepts the original Word, PDF, Excel, TXT, Markdown and HTML set plus PNG, JPG, GIF, WebP, BMP, CSV, JSON and ZIP. The full explicit list is `.doc .docx .pdf .xls .xlsx .txt .md .html .htm .png .jpg .gif .webp .bmp .csv .json .zip`; no extra aliases are claimed.
- **One format registry** - server validation, `/api/capabilities`, the file picker, Docs help, error messages, labels and icons all read the same registry.
- **Honest format handling** - binary formats get signature checks (PNG/JPEG/GIF/WebP/BMP/PDF/ZIP/OLE); DOCX/XLSX are checked as ZIP containers and legacy DOC/XLS by OLE header; text formats are not content-validated. Downloads remain authenticated attachment responses with `no-store` and `nosniff`; image previews are available for PNG, JPG/JPEG, GIF, WebP and BMP only, with no document preview, extraction, execution or malware scanning. Uploads may be optimized in place; text-like files may be stored gzip-compressed and are decompressed transparently on download.
- **Docs UI guidance** - Docs shows a category summary with an expandable full extension list. Image, CSV, JSON and ZIP rows get matching labels/icons.
- **Attachment policy kept separate** - reminder and note attachments still accept any file type within the 25 MiB / 10-file limits; image attachments get a separate preview action, while other file types remain download-only.
- **Upload cleanup fixed** - rejected, mixed, mismatched, replayed, conflicting-epoch, invalid-folder and database-failure uploads now remove both newly received and partially inserted records/files without deleting successful originals.
- Service worker cache bumped to `workspace-v4.5.0`.

## What's New in v4.4.2

- **Docs empty state icon** - the “No files yet” state now uses the single-file icon instead of the copy-style multi-file icon.
- **All smart group** - the Notes and Docs smart groups and their All views now read simply **All**, matching Reminders.
- Service worker cache bumped to `workspace-v4.4.2`.

## What's New in v4.4.1

- **Reverted v4.4.0** - removed the fluid tenant swipe, sliding tenant indicator and animated tab taps. Tenant switching is back to the previous stable tab behavior; folder navigation is unchanged.
- Service worker cache bumped to `workspace-v4.4.1`.

## What's New in v4.3.1

- **Stable sort value size** - Sort and Order dropdowns stay at the compact 13px size on mobile and no longer grow temporarily while focused.
- Service worker cache bumped to `workspace-v4.3.1`.

## What's New in v4.3.0

- **Bullet and numbered lists in Notes** - the Note editor toolbar now has Scrawl-style Bullet list and Numbered list buttons. Lists are saved in note HTML, shown in the editor and rendered on note cards, expanded notes and rich clipboard copies.
- **Smaller Sort/Order values** - Sort and Order dropdown text now uses the notes-preview size (13px) on mobile instead of the 16px title-like size. While focused it temporarily uses 16px to keep iOS focus zoom away.
- Service worker cache bumped to `workspace-v4.3.0`.

## What's New in v4.2.10

- **Copied titles are real headings** - rich-clipboard copies now write the title as an H1 followed by a blank paragraph, so pasting shows a distinct title above the body instead of title-styled text.
- Service worker cache bumped to `workspace-v4.2.10`.

## What's New in v4.2.9

- **Copy includes a blank line** - copied reminder and note text is now Title, one blank line, then the body.
- **Rich copy for notes** - Copy writes both `text/html` and `text/plain` to the clipboard, so bold, italic, underline, headings and links survive when pasted into a rich editor. Plain-text targets receive clean text.
- Service worker cache bumped to `workspace-v4.2.9`.

## What's New in v4.2.8

- **Mobile row actions stack** - on phones, Copy sits above Edit on reminder and note cards, giving the title/note preview more width. Desktop keeps the icons side by side.
- Service worker cache bumped to `workspace-v4.2.8`.

## What's New in v4.2.7

- **App-wide mobile focus-zoom guard** - every text input, select, textarea and contenteditable control is at least 16px on mobile, so iOS never auto-zooms when any field or screen gains focus. The Note title stays 20px.
- Service worker cache bumped to `workspace-v4.2.7`.

## What's New in v4.2.6

- **No mobile zoom in the Note editor** - the Note body and link field are 16px on phones, so focusing them no longer triggers iOS auto-zoom. The title stays 20px; Save and Cancel remain reachable.
- Service worker cache bumped to `workspace-v4.2.6`.

## What's New in v4.2.5

- **H2 is distinct from bold** - the Note title is 20px, H2 is 17px and bold body text stays 15px, so section headings read as headings. On note cards the title is 15px, H2 14px and body text 13px.
- **H2 hierarchy** - H2 is deliberately smaller than the note title but larger than body text.
- Service worker cache bumped to `workspace-v4.2.5`.

## What's New in v4.2.4

- **Note line spacing fixed** - rich-note HTML is normalised on save and display: block wrappers are flattened, trailing empty lines are removed, and runs of blank lines collapse to one consistent blank line.
- Service worker cache bumped to `workspace-v4.2.4`.

## What's New in v4.2.3

- **Formatting below the title** - the Note formatting toolbar now sits directly under the title, matching standard editor layout.
- **Desktop editor width capped** - the full-height Note editor now matches the main container width on web; mobile stays full width.
- Service worker cache bumped to `workspace-v4.2.3`.

## What's New in v4.2.2

- **Toolbar keeps the note selection** - on mobile, tapping Bold, Italic, Underline, Heading or Link now retains the selected text instead of collapsing the selection.
- Service worker cache bumped to `workspace-v4.2.2`.

## What's New in v4.2.1

- **True rich-text Note editor** - bold, italic, underline, H2 headings and links now format live inside the editor instead of showing Markdown syntax.
- **Formatting on note cards** - saved formatting renders in both the collapsed preview and the expanded note, with safe HTML sanitising.
- **Note format migration** - notes now carry a text/HTML body format; existing text notes are converted to rich HTML when next saved, and JSON backup preserves the format.
- Service worker cache bumped to `workspace-v4.2.1`.

## What's New in v4.2.0

- **Full-screen Note editor** - editing a Note now opens a full-height editor with the note body as the main area. Reminder editing keeps its existing sheet.
- **Formatting toolbar** - Notes support bold, italic, underline, H2 headings and links. Formatting is stored as Markdown and rendered on note cards (bold, italic, underline, headings and safe links).
- **Notification polish** - removed the redundant “Notifications enabled” toast that overlapped the Notifications sheet and made the test button look like a broken bordered card.
- Service worker cache bumped to `workspace-v4.2.0`.

## What's New in v4.1.4

- **Tenant swipe removed** - horizontal swipes on mobile Home no longer switch Reminders / Notes / Docs. Use the tenant selector tabs; folder navigation keeps its existing slide animation.
- Service worker cache bumped to `workspace-v4.1.4`.

## What's New in v4.1.3

- **Tenant swipe reverted** - the animated full-screen tenant transition from v4.1.2 is removed. Mobile left/right swipes switch Reminders / Notes / Docs instantly again; folder navigation keeps its existing slide.
- Service worker cache bumped to `workspace-v4.1.3`.

## What's New in v4.1.1

- **Folder colours in item sheets** - the Notes and Docs folder icons now use the selected folder's colour, matching Reminders.
- **Full-width Download button** - the File sheet download link is now a centred, full-width button with the download icon and the word Download.
- **No focus outlines** - removed the global focus outline and the selected-day outline; the search field no longer switches to an accent focus border.
- **Folder header alignment** - the Folders heading now shares the same 8px left inset as the smart-group and folder icons.
- **No mobile scrollbars** - mobile scrolling surfaces hide their scrollbars.
- **Swipe between tenants** - on mobile Home, swipe left/right to move between Reminders, Notes and Docs.
- Service worker cache bumped to `workspace-v4.1.1`.

## What's New in v4.1.0

- **Workspace-wide token permissions** - the existing bearer key can now be granted explicit Notes, Docs, file, storage and search scopes without changing or reissuing the secret. Reminders keep their existing read/write/legacy behaviour; new scopes are opt-in in Settings.
- **Read boundaries closed** - token calls to `/api/state`, `/api/lists`, search and storage are filtered to authorized tenants. Unauthorized arrays come back empty with `filtered: true`.
- **Notes and Docs API** - collection/detail reads, Notes create/edit/delete, Docs upload/move/delete, reminder/note attachments, private downloads, scoped storage and search. Writes use idempotency keys; revisions and store-epoch guards protect against stale edits.
- **Discovery** - `GET /api/capabilities` reports effective scopes, supported Docs formats, upload limits, search fields and backup scope.
- **Safer file lifecycle** - attachment folder IDs stay in sync when parents move, completed-reminder retention removes attachments and files, and uploads clean up temp files on replay or failure.
- **Storage and backup wording** - storage text now counts UTF-8 bytes, largest files show the tenant, JSON backup is labelled as text/metadata only, and Settings documents that a complete restore needs both the database and uploads.
- Service worker cache bumped to `workspace-v4.1.0`.

## What's New in v4.0.0

- **Renamed to Workspace** - the app is now Workspace everywhere: browser title, sign-in screen, PWA name, notification copy, backup filename and service-worker cache.
- **New W icon** - the app icon and favicon are a single Fraunces W, keeping the existing dark rounded-square style.
- **New address** - the app now lives at its new Workspace address; the previous ToDo address is retired.
- Service worker cache bumped to `workspace-v4.0.0`.

## What's New in v3.1.13

- **Username form alignment** - New username and Current password now share one full-width row; Update Username spans the full width like Update Password.
- **Storage in the hamburger menu** - the menu now shows the current storage total on both web and mobile; tapping it opens Settings at the Storage group.
- Service worker cache bumped to `todo-v3.1.13`.

## What's New in v3.1.12

- **Sort Notes and Docs** - both tenants now have the Sort/Order bar: Date added or Name, ascending or descending. Each Notes and Docs folder remembers its own choice.
- **Sorting is global in Settings** - Sorting moved into its own generic Settings group. It sets defaults for Reminders, Notes and Docs; Due date is marked Reminders-only.
- Service worker cache bumped to `todo-v3.1.12`.

## What's New in v3.1.11

- **Docs card alignment fixed** - the combined title + folder block, file type, size, download icon and delete icon now share one true vertical centre. Download and delete line up exactly.
- Service worker cache bumped to `todo-v3.1.11`.

## What's New in v3.1.10

- **File title matches reminders** - Docs file names now use the exact reminder-title font: 15px, non-bold, same line height, in both the file card and the File sheet.
- Service worker cache bumped to `todo-v3.1.10`.

## What's New in v3.1.9

- **Open a file from its card** - tapping a Docs file now opens a file sheet showing its info, a folder picker and a download link.
- **Move files between folders** - choose a new folder in the file sheet and Save to move the file.
- **Folder under the title** - file cards now show the folder below the title, matching Reminders and Notes.
- **Download icon** - the row download control is now just an icon, not a text button.
- Service worker cache bumped to `todo-v3.1.9`.

## What's New in v3.1.8

- **Docs row polish** - file titles are no longer bold, the ambiguous copy-style icon is replaced with a single file icon, and file rows are vertically centred instead of top-aligned.
- Service worker cache bumped to `todo-v3.1.8`.

## What's New in v3.1.7

- **Notes folder placement** - the folder now appears below the note title, before the note preview, matching reminder cards.
- **Storage only in Settings** - the Docs storage card and hamburger Storage entry are gone; storage lives only in Settings.
- **Settings grouped by tenant** - tenant-specific settings are collected under a **Reminders** group (folder progress, defaults, sorting, notifications, time zone, API tokens); Appearance, Storage, Backup and account stay generic.
- **HTML in Docs** - Docs now accepts `.html` and `.htm` files alongside Word, PDF, Excel, TXT and Markdown.
- Service worker cache bumped to `todo-v3.1.7`.

## What's New in v3.1.6

- **Saved notes update immediately** - saving a note now refreshes its row preview without a manual page refresh, including when you stay in the same folder.
- **Docs update immediately** - uploading files while inside a Docs folder now shows them in the list straight away.
- **Docs folders open correctly** - opening a Docs folder from the sidebar now shows that folder instead of falling back to All Files.
- Service worker cache bumped to `todo-v3.1.6`.

## What's New in v3.1.5

- **Notes rows match reminders** - the note title now sits above a two-line note preview with an ellipsis instead of appearing beside it.
- **Expand notes on the card** - tapping a long note expands and collapses it exactly like a reminder note.
- **Copy notes** - every note row now has the same copy icon as reminder items.
- Service worker cache bumped to `todo-v3.1.5`.

## What's New in v3.1.4

- **Collapsible search** - the search bar is now a search icon in the tenant bar, placed before Refresh. Tapping it expands the search over the bar from the right edge to the left, Scrawl-style, with a close ×.
- **One top bar** - Reminders / Notes / Docs, Search, Refresh and the hamburger menu share the top bar.
- Service worker cache bumped to `todo-v3.1.4`.

## What's New in v3.1.3

- **Actions in the search row** - Refresh and the hamburger menu now sit on the same row as the search bar.
- **Clean tenant bar** - the Reminders / Notes / Docs bar sits directly below the search row with no action icons.
- Service worker cache bumped to `todo-v3.1.3`.

## What's New in v3.1.2

- **Search on top** - the search bar now sits above the Reminders / Notes / Docs bar, which still holds Refresh and the hamburger menu.
- **One search scope** - the tenant/scope selector was removed from the search bar; search always covers all tenants.
- Service worker cache bumped to `todo-v3.1.2`.

## What's New in v3.1.1

- **Tenant bar at the top** - Reminders / Notes / Docs now share the top bar with Refresh and the hamburger menu.
- **Search spacing** - the search bar has proper space above and below, with matching input and scope-selector padding.
- Service worker cache bumped to `todo-v3.1.1`.

## What's New in v3.1.0

- **All keyboard shortcuts removed** - the Shortcuts sheet, its header button and the S/N/Cmd+K/Cmd+Shift+M/Esc shortcuts are gone. Sheets close with Cancel, Done, the backdrop or Back.
- **Search above the tenant selector** - the search bar now sits above Reminders / Notes / Docs.
- **Search scope** - a selector on the right of the search bar searches **All tenants** by default, or only Reminders, Notes or Docs.
- **Global search results** - one search can now show Reminder, Note and Docs groups together.
- Service worker cache bumped to `todo-v3.1.0`.

## What's New in v3.0.1

- **All entries match** - All reminders, All Notes and All Files now share the same grid icon.
- **Storage moved to the menu** - the hamburger/account menu now has a Storage entry with the current total; opening it shows the total, per-tenant breakdown and largest files.
- **Tenant-aware N shortcut** - `N` now opens the Reminder editor, Note editor, or Docs file picker depending on the active tenant.
- Service worker cache bumped to `todo-v3.0.1`.

## What's New in v3.0.0

- **Three tenants: Reminders, Notes and Docs** - the main page now has a Reminders / Notes / Docs selector. The old To-do tenant is Reminders.
- **Folders everywhere** - existing lists became Reminders folders; Notes and Docs use the same folder structure, terminology and delete interactions.
- **Notes tenant** - folders contain notes with attachments, with no dates, scheduling or completion. Notes can be edited and deleted.
- **Docs tenant** - folders contain Word, PDF, Excel, TXT and Markdown files. Files are added from the + button and use the existing swipe-left delete interaction.
- **Reminder attachments** - items in Reminders can now carry file attachments alongside their notes.
- **Storage usage** - Settings shows total storage plus a per-tenant breakdown and the largest files, with manual deletion. Docs also shows its own usage.
- Service worker cache bumped to `todo-v3.0.0`.

## What's New in v2.13.35

- **Copy an item from its row** - a copy button now sits before the pencil on every reminder row. It copies the title to the clipboard, followed by the note on a new line when one exists, and shows a **Copied** toast.
- Service worker cache bumped to `todo-v2.13.35`.

## What's New in v2.13.31

- **The Shortcuts sheet no longer auto-focuses Done** - opening it with **S** or the toolbar button leaves focus where it was, so Done has no focus ring. Esc and Done still close the sheet.
- Service worker cache bumped to `todo-v2.13.31`.

## What's New in v2.13.30

- **S opens the Shortcuts sheet** - pressing **S** (desktop/web, when not typing and no sheet is open) opens the Shortcuts sheet. Its first row is now **Show this shortcuts menu → S**. The header Shortcuts button and all other shortcuts are unchanged.
- Service worker cache bumped to `todo-v2.13.30`.

## What's New in v2.13.29

- **Refresh now sits before Shortcuts** - the header action order is list options (when present), Refresh, Shortcuts, then the menu, on both Home and list screens. The Shortcuts sheet and all keyboard shortcuts are unchanged.
- Service worker cache bumped to `todo-v2.13.29`.

## What's New in v2.13.28

- **Shortcut hints now live in one Shortcuts sheet** - a keyboard-icon button before Refresh on Home and list screens opens an in-app Shortcuts sheet listing **N** new item, **Cmd/Ctrl+K** search, **Cmd/Ctrl+Shift+M** More options and **Esc** close/search/Back. The inline keycaps beside the + button, Back, Cancel and More options are gone. The button and sheet are for the desktop/web app and are hidden on touch phones.
- Service worker cache bumped to `todo-v2.13.28`.

## What's New in v2.13.27

- **Keyboard shortcuts** - press **N** anywhere the + button is visible to open New Item, **Cmd/Ctrl+Shift+M** to expand or collapse More options while adding, and **Esc** to close the top sheet, clear search, or go Back from a list. Subtle desktop key hints appear by the + button, on Back and Cancel, and beside More options; they are hidden on phones. The existing Cmd/Ctrl+K search shortcut is unchanged.
- Service worker cache bumped to `todo-v2.13.27`.

## What's New in v2.13.26

- **Deleting a row no longer rebuilds the list** - swipe-left or desktop × now removes just that row and updates the list counts, completed filter and empty states in place. The row above stays exactly where it was, only the rows below slide up, and the scroll position is untouched. Scroll anchoring is disabled during the collapse so the browser cannot nudge the row above.
- Service worker cache bumped to `todo-v2.13.26`.

## What's New in v2.13.25

- **Deleting a task keeps your place** - swipe-left or desktop × deletion captures the list's scroll position before the row collapses and restores it after the list re-renders. Only the rows below slide up into the freed space; the list no longer jumps to the top.
- Service worker cache bumped to `todo-v2.13.25`.

## What's New in v2.13.24

- **No more browser pop-ups** - deleting an item from the editor, deleting a list, changing token access and revoking a token now use the same in-app two-step confirmation as the list rows: **Delete / Change access / Revoke → Confirm?**, resetting after about four seconds. List deletion adds an inline warning that its items go too, and recurring items keep their permanent series warning. No native `confirm`, `alert` or `prompt` dialogs remain anywhere.
- Service worker cache bumped to `todo-v2.13.24`.

## What's New in v2.13.23

- **Optional username login** - the single-user account can now have a username. New installs choose one at setup; existing installs keep password-only login and get a one-time **Choose your username** prompt after signing in. Once set, login asks for username + password, ignores case and surrounding spaces, and returns the same “Incorrect username or password” for either failure.
- **Account management** - Settings shows the current username and lets you change it with your current password. A password change now signs out every other browser while keeping the current one signed in.
- **Migration note** - this version adds a nullable `users.username` column; reminders, lists and settings are untouched. Back up the database before upgrading. Rollback: restore the backup or run `ALTER TABLE users DROP COLUMN username`. API tokens still work without a username.
- Service worker cache bumped to `todo-v2.13.23`.

## What's New in v2.13.22

- **Un-completing now gets the same glow as completing** - both directions use the identical 0.32s list-colour halo. Each row is held for ~340ms so the full halo is visible before it moves, and un-completing still shows the ring emptying and the check icon fading. Failed requests restore the previous state.
- Service worker cache bumped to `todo-v2.13.22`.

## What's New in v2.13.21

- **Un-completing now shows the checkbox clearing first** - the ring empties in place with a short unpop animation and the check icon fades out, held for about a fifth of a second before the row moves back to the open group. A failed request restores the filled check. Completion feedback is unchanged.
- Service worker cache bumped to `todo-v2.13.21`.

## What's New in v2.13.20

- **Completed titles keep their normal font size** - v2.13.18 had reduced completed titles to the note size. They now keep the same size and line-height as open titles (15px, or 14px in Compact) and step down by colour only: the title uses the note-level `--text-2`, while notes, link chips, due line, completed date and metadata stay muted. The filled check remains the completion marker and there is still no strike-through.
- Service worker cache bumped to `todo-v2.13.20`.

## What's New in v2.13.19

- **The search bar stays visible when the iPhone keyboard opens** - focusing either search field on a touch phone now brings the current screen to the top and compensates for iOS's keyboard viewport offset on the sticky header. The search field stays on screen and results begin at the first hit instead of deep in the old list position. Blur restores the header; desktop scroll positions are untouched.
- Service worker cache bumped to `todo-v2.13.19`.

## What's New in v2.13.18

- **Completed rows use a clear three-level hierarchy** - the completed title now takes the list-note style (13px, line-height 1.4, `--text-2`; 12px in Compact), while the note, link chips, due line, completion date and metadata drop to the muted `--text-3` level. Link chips use weight 500 and the due line is no longer bold. Open rows are unchanged, and completed titles still have no strike-through.
- Service worker cache bumped to `todo-v2.13.18`.

## What's New in v2.13.17

- **Completed titles no longer have a strike-through** - finished items keep the muted grey title but are no longer crossed out (including during the completion animation), so saved completed items stay readable for reference. The filled check remains the completion marker.
- **Completed history is newest-completed first** - the Completed view now defaults to **Date completed / Newest on top**; the new Date completed option appears only there, and Date added / Due date / Name are still selectable. Each list's Completed section always shows the most recently completed item first, even if that list sorts its open items another way. Un-completing and re-completing an item moves it back to the top.
- Service worker cache bumped to `todo-v2.13.17`.

## What's New in v2.13.16

- **Note line breaks survive link chips** - URLs are still moved into chips, but the newlines around them are preserved even when the URL sits on its own line. A standalone Notebook or YouTube link no longer merges the paragraphs on either side in the expanded note.
- **Natural-language dates are suggestions, not autofill** - typing a date/time/repeat now shows a **Use …** chip and changes nothing by default. Tap it to apply; the chip then turns into a remove (×) action. Ignoring it saves the item undated, and manual schedule edits lock the suggestion. This keeps quick-add from silently becoming dated.
- Service worker cache bumped to `todo-v2.13.16`.

## What's New in v2.13.15

- **New List plus stays a bare glyph** - removed the filled/dark hover and focus state so the plus no longer turns into a boxed button (and iOS cannot leave it stuck after a tap). It keeps the quiet grip colour, the "New List" tooltip and accessible name, and its exact alignment with the drag grips. Service worker cache bumped to `todo-v2.13.15`.

## What's New in v2.13.14

- **New List is now a plus button** - the `Lists` section header uses a bare 22px plus instead of the "New List" text. Its right edge and centre line up exactly with the drag grips below it on both phone and desktop, and the touch target stays 44px. Service worker cache bumped to `todo-v2.13.14`.

## What's New in v2.13.13

- **Typo-tolerant search** - search now finds reminders even when the query is misspelled or the word order differs. Every query word must match somewhere in the title or notes, with one typo allowed for 3–7 letter words and two for longer ones; accents are ignored and transposed letters count as one edit. Results are grouped Open then Completed as before, but each group is now best-match first, so the Sort/Order bar is hidden while searching. Offline fallback uses the same matcher. Service worker cache bumped to `todo-v2.13.13`.
- **iPhone status-bar tap-to-top** - on touch phones the document is now the scroller, so tapping the status bar jumps Home and lists to the top. Headers stay pinned; desktop and narrow desktop windows keep their existing nested scrolling and scrollbars.

## What's New in v2.13.11

- **Reverted the custom sort selects** - restored the previous native Sort and Order selects, removing the explicit height, disabled native appearance, and custom chevron added in v2.13.10. The nearby labels and values return to the previous look.
- Service worker cache bumped to `todo-v2.13.11`.

## What's New in v2.13.10

- **Sort dropdown text is centred on iPhone** - the Sort and Order selects now use an explicit control height and line-height with native appearance disabled, plus a custom chevron. iOS no longer seats the selected text low inside the 44px control; labels and values share the same centre line. The sort row still fits on one line with all labels visible.
- Service worker cache bumped to `todo-v2.13.10`.

## What's New in v2.13.9

- **Theme changes enable Save on the first click** - the theme preference and localStorage now update immediately, while only the visual View Transition is deferred. Previously the dirty check ran before the preference changed, so the first Light/Dark/Auto click could leave Save disabled until a second change.
- Service worker cache bumped to `todo-v2.13.9`.

## What's New in v2.13.8

- **Completed filter highlight is quieter** - the active **✓ N** pill now uses the theme’s subtle grey fill and normal text colour in both light and dark instead of a black/white accent fill. Hover darkens the grey slightly; the FAB remains the only bright accent element.
- Service worker cache bumped to `todo-v2.13.8`.

## What's New in v2.13.7

- **Completed is now a compact check + count** - the sort bar shows **✓ N** at the far right, where N is the number of completed items in that list. Tap it to show or hide them; the pill fills with the accent colour while active and is dimmed when the list has none. Sort and Order labels stay visible at every width, and the row remains a single line down to 320px.
- Service worker cache bumped to `todo-v2.13.7`.

## What's New in v2.13.6

- **Long notes are click/tap only** - removed the keyboard focus and Enter/Space toggle added in v2.13.5. The ellipsis remains the expand indicator, and the card still expands on tap/click.
- **Sort bar stays on one row** - the phone layout no longer wraps Completed onto a second line. Labels now stay visible; v2.13.7 replaced the switch with the compact **✓ N** filter.
- Service worker cache bumped to `todo-v2.13.6`.

## What's New in v2.13.5

- **Long notes lose the chevron** - the two-line ellipsis is now the only indicator that a note can expand. Tapping or clicking the card still expands and collapses it, and long notes stay keyboard-accessible: tab to the note, then press Enter or Space. Short notes are not focusable. The note text now uses the full card width.
- Service worker cache bumped to `todo-v2.13.5`.

## What's New in v2.13.4

- **Completed section reverted** - restored the separate **“Completed items are kept indefinitely.”** message with the right-aligned **Edit list** button. The rest of the v2.13.3 polish remains: no touch press highlight, the smaller 24×14 switch, larger notes, and fully wrapping titles.
- Service worker cache bumped to `todo-v2.13.4`.

## What's New in v2.13.3

- **List-view polish** - phones no longer flash a pressed background when a row is touched; desktop still shows the mouse-hover background. The Show Completed switch is smaller (24×14) to match the 12px label, and list-view note text is 13px (12px in Compact density). Titles still wrap fully with no ellipsis; only notes use the two-line preview.
- Service worker cache bumped to `todo-v2.13.3`.

## What's New in v2.13.2

- **Retention confirmation is now in-app** - shortening a list's completed retention shows a red warning inside Edit List instead of a browser pop-up. It names the exact number of completed items that will be deleted; if none are old enough, the list saves immediately with no destructive prompt. While the warning is open, Save is disabled and the choices are **Keep current** or **Delete and save**. Editing the name, color, or retention dismisses the warning.
- Service worker cache bumped to `todo-v2.13.2`.

## What's New in v2.13.1

- **Swipe-back no longer slides twice** - browser/hardware Back and the mobile edge-swipe gesture now skip the app's custom 260ms pop animation, leaving only the browser's native transition. The in-app Back icon still slides out. This also prevents a history-driven Back from cancelling or duplicating an in-progress screen transition; sheet Back behavior is unchanged.
- Service worker cache bumped to `todo-v2.13.1`.

## What's New in v2.13.0

- **Completed retention is per list** - each list now has its own **Completed retention** choice in Edit List: 1 month, 3 months, 6 months, 1 year, or indefinitely (default). Every existing and new list starts at indefinitely; there is no global retention setting. Shortening a list's window asks first, in-app, and permanently deletes only that list's older completed one-off items; repeating-series history is kept.
- **The completed section explains its window** - when Show Completed is on, the Completed heading says how long that list keeps finished items and offers an **Edit list** shortcut. The all-lists Completed view has a generic note because different lists can keep different windows.
- Service worker cache bumped to `todo-v2.13.0`.

## What's New in v2.12.1

- **List back-slide matches the entry** - the mobile pop transition now uses a gentler ease-in-out over the same 260ms instead of the entry's fast-start ease-out, so tapping Back no longer feels like a snap. Push is unchanged; a finger-driven browser back gesture still follows the finger.
- Service worker cache bumped to `todo-v2.12.1`.

## What's New in v2.12.0

- **Long-note collapse keeps your place** - after expanding a very long note and scrolling through it, collapsing now brings that same item back into view instead of leaving you on the later rows that were underneath. Expanded notes also keep their paragraph breaks instead of joining into one block.
- **Rapid deletes work through the toast** - the "Item deleted" toast is now click-through (only an action button is tappable) and dismisses as soon as you start another row action, so confirming item 2 immediately after item 1 is not swallowed.
- **Mobile list push/pop** - opening a list slides it in from the right over Home; Back (button or browser Back) slides it out to the right. Desktop keeps its instant navigation. Since v2.13.1 browser/hardware Back uses the browser’s own transition instead of a second custom pop.
- **Completed retention** - Settings → Completed items can keep completed items for 1 month, 3 months, 6 months, 1 year, or indefinitely (default). Shortening the window permanently deletes older completed one-off items and asks first; repeating-series history is kept. State, search, list counts, the Completed view and its empty copy all follow the chosen window.
- **Show Completed is a compact filter** - the sort bar shows **✓ N** at the far right, where N is the completed count. Tapping it shows or hides completed items; it uses a subtle grey fill while active and is dimmed when there are none. It stays on one row with Sort and Order at every phone width. Showing completed preserves your scroll position; hiding it collapses the section without jumping to the top, landing near the end of the active items.
- **Bottom-sheet transitions on phones** - New Item, Edit Item, Settings, the list sheet and other sheets slide up from the bottom and slide back down on Save/Cancel/backdrop/Escape. Desktop keeps its centered modal.
- Service worker cache bumped to `todo-v2.12.0`.

## What's New in v2.11.3

- **Long notes open with a single tap** - removed the persistent selected row and its gray fill/accent bar. A tap or click on a long-note card now expands its note immediately; another tap collapses it. Tapping a different long-note card collapses the previous note and opens the new one. The existing hover highlight on desktop is the only row highlight; v2.13.3 removed the touch press highlight. Since v2.13.5 the chevron is gone and the ellipsis is the expand indicator. Since v2.13.6 expansion is click/tap only, with no keyboard focus target. Short/no-note cards stay inert, and scrolling/swiping never expands.
- Service worker cache bumped to `todo-v2.11.3`.

## What's New in v2.11.2

- **Tap the card to expand a long note** - the See more / See less buttons are gone. A long note keeps its two-line preview and gains a tiny chevron. The first tap on that card selects and highlights it without expanding; a second tap expands or collapses the note. Tapping a different long-note card moves the highlight there and closes the previous note. The chevron is a direct shortcut: one tap expands/collapses it immediately, no selection step.
- Short or note-less cards stay inert, scrolling/swiping never selects or expands, and only one note is open at a time.
- Service worker cache bumped to `todo-v2.11.2`.

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
- **Search covers retained history** — search is global, not scoped to the open list, and runs on the server so completed to-dos beyond the active view are included within each list's retention window. Results are grouped Open then Completed, and each row shows its list.
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
- Completed reminders follow each list's **Completed retention** choice in Edit List: 1 month, 3 months, 6 months, 1 year, or indefinitely (default). Retention is permanent for completed one-off items; repeating-series occurrence history is kept. `GET /api/state` loads completed items within each list's window, search is scoped to retained items, and the per-list Show Completed switch is remembered.
- Deleting is inline (no browser dialogs): on touch, swipe any row left — including completed rows — to reveal the red Delete action (centered label), tap it once for “Confirm?”, tap again to delete; swipe right closes the reveal. On the web there is no swipe; hover the row and click the ×, then “Confirm?”. The card slides away when deleted.
- Search across active reminders and retained completed history.
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
- ImageMagick (`convert`/`magick`) for image compression
- Ghostscript 10+ (`gs`) for PDF compression; PDFs are stored unchanged when either tool is unavailable
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

Install the compression tools first: `brew install imagemagick ghostscript` (macOS) or `apt-get install -y imagemagick ghostscript libheif-plugin-libde265 libheif-plugin-x265` (Ubuntu). Without them uploads still work; images/PDFs are stored unchanged.

Open http://127.0.0.1:3006. The first visit asks you to create a password (minimum 8 characters). There is no registration and no password recovery.

### Upload compression policy

- ImageMagick (`convert`/`IMAGEMAGICK_BIN`) optimizes JPEG, PNG, WebP and GIF: auto-orient, max 2400 px long edge without enlargement, ICC profile kept, EXIF stripped, JPEG quality 82, PNG 256-colour quality 90, WebP quality 82, animated GIF/WebP preserved.
- Ghostscript (`gs`/`GHOSTSCRIPT_BIN`) rewrites PDFs larger than 50 KiB with `/ebook` settings (150 dpi colour/grey, 300 dpi mono). A PDF is replaced only when at least 3% smaller.
- Text-like files are gzip-compressed when they save at least 8%; downloads are decompressed to the exact original bytes.
- HEIC/HEIF uploads are converted to JPG (quality 82 when optimization is on, 90 when off) so browsers can preview them. Images are replaced only when the candidate is at least 8% smaller. If ImageMagick/Ghostscript is missing or processing fails, the original is kept and the outcome is logged. ZIP/Office files and BMP are not reprocessed; existing uploads are never rewritten.
- Lossy optimization is on by default and can be turned off in Settings → Uploads. When on, only the optimized image/PDF copy is kept; the File sheet states whether Download returns the original or the optimized copy. HEIC/HEIF always becomes JPG because browsers cannot preview HEIC reliably.
- Standalone Docs advertises 20 formats, including `.jpg`, `.jpeg`, `.heic` and `.heif`. iOS Photos commonly returns `.jpeg`; HEIC/HEIF are converted to JPG.
- Production nginx needs `client_max_body_size 260m`, `client_body_timeout 300s`, `proxy_read_timeout 600s`, `proxy_send_timeout 600s`, and `proxy_request_buffering off` for a 10 × 25 MB batch.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3006` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `DATA_DIR` | `./data` | SQLite directory |
| `CONTACT_EMAIL` | `your@email.com` | VAPID contact email; set your own |
| `GHOSTSCRIPT_BIN` | `gs` | Ghostscript executable used for PDF compression |
| `IMAGEMAGICK_BIN` | `convert` | ImageMagick executable used for image compression |

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

- `GET /api/state` (lists, reminders, notes, docs, attachments, non-secret settings)
- `GET /api/capabilities` (API version, effective scopes, limits, search fields, backup scope)
- `GET /api/settings`, `POST /api/settings` (allowlisted keys only)
- `POST /api/settings/sort` (synced per-view sorting; one intent per call - single view, apply-all, or first-device seed - merged server-side)
- `POST` / `PATCH` / `DELETE /api/lists[/:id]`
- `PUT /api/lists/order`
- `POST /api/reminders`, `PATCH` / `DELETE /api/reminders/:id`
- `POST /api/reminders/:id/skip|unskip|snooze|reschedule`, `GET /api/reminders/:id/occurrences`
- `POST /api/parse` (natural-language title parsing)
- `GET /api/lists`, `GET /api/reminders` (also usable with a token)
- `GET/POST /api/notes`, `GET/PATCH/DELETE /api/notes/:id`, `GET/POST /api/notes/:id/attachments`
- `GET/POST /api/docs`, `GET/PATCH/DELETE /api/docs/:id`, `GET /api/files/:id`, `GET /api/files/:id/preview` (image-only)
- `GET/POST /api/reminders/:id/attachments`, `DELETE /api/attachments/:id`
- `GET /api/storage`
- `GET /api/tokens`, `POST /api/tokens`, `POST /api/tokens/:id/permissions`, `POST /api/tokens/:id/profile`, `POST /api/tokens/:id/revoke`
- `GET /api/export`, `POST /api/import`
- `POST /api/push/subscribe`, `/unsubscribe`, `/test`, `/action` (signed notification actions)
- `POST /api/password`
- `POST /api/logout`

Personal access tokens (`Authorization: Bearer $TEST_TOKEN`, created in Settings) come in three profiles. A bad bearer is rejected with `401` on every `/api` route; token responses are never cached (`Cache-Control: no-store`); use tokens only over HTTPS — they are bearer secrets.

- **read** (default for new tokens): `GET /lists`, `/reminders`, `/reminders/:id`, `/reminders/:id/occurrences`, `/state`, plus `POST /parse` (read-only natural-language date parsing, same engine as the editor).
- **write**: everything in read, plus idempotent `POST /reminders`, full-edit `PATCH /reminders/:id`, and `POST /reminders/:id/snooze|skip|reschedule`. Every write-profile mutation REQUIRES an `Idempotency-Key` header (1–200 chars) and `base_revision` + `base_epoch` (see below).
- **legacy** (migration-only, never selectable): exactly the pre-profile capabilities — reads, key-optional creates, and complete-only PATCH.

Additional tenant permissions are opt-in scopes on the same token record. Existing tokens migrate with an empty list and keep exactly their reminder profile; the owner changes them in Settings (`POST /api/tokens/:id/permissions`, session-only). Valid scopes are `notes:read`, `notes:write`, `notes:delete`, `docs:read`, `docs:write`, `docs:delete`, `storage:read`, `search:read`. `write` does **not** imply any new-tenant permission.

- Notes/Docs reads use `GET /api/notes`, `/api/notes/:id`, `/api/docs`, `/api/docs/:id`; Docs search matches filenames only. Omitting `limit` returns the entire authorized collection with `complete: true`. An explicit `limit` (1–500) returns at most that many rows with `complete`/`has_more`, `total`, and a `scope` object (`collection`, `folder_id`, `token_filtered`). The explicit limit is a truncation, not a resumable cursor; sync clients should omit it and never infer deletion from a partial or differently scoped response.
- Notes create/edit needs `notes:write`; Notes delete needs `notes:delete`. Docs upload/move/rename needs `docs:write`; Docs delete needs `docs:delete`. Note/reminder attachments follow the parent: read to list/download, write to upload, `notes:delete`/`docs:delete` to delete.
- `GET /api/files/:id` is authorized by the owning parent, never by file ID alone. Downloads are private/no-store and use attachment disposition. `GET /api/files/:id/preview` uses the same parent authorization, serves only PNG/JPG/JPEG/GIF/WebP/BMP after a signature check, and returns `inline` with `private, no-store` and `nosniff`. Docs extensions are `.doc .docx .pdf .xls .xlsx .txt .md .html .htm .png .jpg .jpeg .gif .webp .bmp .heic .heif .csv .json .zip`; HEIC/HEIF are converted to JPG before storage. Reminder/note attachments remain unrestricted by extension within the upload limits.
- `/api/state`, `/api/lists`, `/api/search`, `/api/storage` and largest-file results are filtered for token callers; unauthorized arrays are empty, and responses include `filtered: true`. A query parameter only narrows access.
- `/api/capabilities` reports effective capabilities, the exact Docs format list plus category/label/MIME details, upload limits (25 MiB per file, 10 files per request), search fields, JSON-backup scope, and the current upload-compression policy. Docs and attachment rows expose logical `size`, `original_size`, `stored_size`, `compression` and `optimization` where applicable.

`GET /api/tokens` shows each token's profile and additional scopes (never hashes). Deleting reminders, managing folders, settings, token management, import/export, password, and push stay session-only for every profile.

**Write-protocol.** Reminder writes keep the existing strict/`Idempotency-Key`/revision protocol. Notes and Docs writes require an `Idempotency-Key` header; Notes PATCH/DELETE, Docs move/rename/delete and attachment delete also require `base_revision` + `base_epoch`. Uploads require `Idempotency-Key` + `base_epoch`; Docs/attachment fingerprints use normalized file metadata plus SHA-256 file-content hashes, never multipart boundaries, and temporary files are removed on replay or validation failure. First execution of every revisioned mutation needs `base_revision` (integer) and `base_epoch` (string); missing or wrongly typed → `400`. The server checks `base_epoch` against its `store_epoch` setting (regenerated on every backup import, nowhere else) → mismatch is `409 {"error": "Store was restored since your read"}` — never bypassed. Mutations apply as one atomic compare-and-write (`revision = revision + 1` in the same statement); a stale base → `409 {"error": "Reminder changed since your read", "reminder": <current row>}`. Replays (same key + byte-identical body) return `200 {"deduplicated": true, "original_status", "result"}` where `result` is the FROZEN first-execution outcome (historical — follow up with `GET /api/reminders/:id` for current state); a retried snooze keeps its original absolute time, never recomputed. Same key with a different raw payload → `409`. Keys are namespaced per token and per concrete route, survive deletion where applicable, and the fingerprint covers the raw request only — resolved defaults and server-computed targets are frozen at first execution, so replaying the same raw request is stable across Settings changes, list renames, and clock moves. Token bodies are strictly validated (unknown fields and wrong types → `400` naming the field); session callers keep their lenient behavior.

**Recurring series (write profile).** `PATCH {"completed": true}` and `POST …/skip` on a recurring reminder must include `occurrence_at`. If it equals the current `due_at`, the operation proceeds (same-occurrence duplicates are harmless). If it differs and that occurrence is already recorded done, the server answers `200 {"ok": true, "alreadyDone": true}` without advancing again (this recognition bypasses only the revision check, never the epoch guard). Otherwise → `409 {"error": "Stale occurrence", "currentDue"}`.

**Change tracking.** Every reminder carries `revision` (monotonic integer, bumped by every content/state mutation including UI edits and occurrence-scope edits — never by push bookkeeping) and `updated_at`/`notified_at`. `GET /api/reminders` with NO filters returns the COMPLETE snapshot (every row, `ORDER BY id`, `complete: true`, top-level `store_epoch`): diff two snapshots by `id` to see everything, including hand edits from the UI. Only absence from that unfiltered snapshot implies deletion; filtered/limited responses are convenience reads, not change signals. No cursors, no feeds, no polling promises.

**Docs format caveat.** Storage/download support is not preview support. DOCX/XLSX signature checks only prove a ZIP container; legacy DOC/XLS only prove an OLE header; text formats are not content-validated. Zero-byte text files are accepted, zero-byte binary files are rejected. No ZIP extraction or malware scanning occurs.

**Backup caveat.** Settings → Backup is a JSON text/metadata export: it does not include uploaded file bytes. A complete Workspace restore needs both `data/todo.db` and `data/uploads` from the same point in time. Storage figures are logical counters (file sizes plus SQLite text bytes), not a physical disk audit.

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
