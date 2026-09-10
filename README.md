# Charlie — Life Journal

A self-hosted journal for Charlie's people, places, memories, growth, and future chapters. Made for a single owner and an Unraid NAS.

## Features

- A Life outline view preserving all 20 sections, original topics, and Travel/Life Timeline subheadings from the Markdown outline. File entries under a section and topic.
- Create, edit, and delete entries with dates, moods, tags, favorites, life chapters, and outline topics.
- Autosave after a 1.2-second writing pause, with a visible saved/pending state and browser draft recovery during connection failures.
- On this day: entries from the same local calendar date in earlier years, including exact February 29 matching.
- Search writing, titles, tags, chapters, and section names; filter by section or mood.
- A chronological timeline with chapter filters, including **2026 — Rebuilding**.
- A memory box linking keepsakes to stories. Attach images, voice notes, videos, PDFs, or text files. Preview supported media and download originals. Maximum 25 MB per file and 20 attachments per entry.
- Opens directly without a password. Cross-origin mutation protection remains in place.
- Persistent SQLite storage including attachments. No external services, analytics, fonts, API keys, or third-party runtime packages.
- Minimal charcoal theme with a single-column journal, on-demand navigation, and a spacious writing editor. Prompts, filters, metadata, and attachments stay tucked away until needed.
- Responsive desktop and mobile layouts, keyboard-accessible editing, and unsaved-change warnings.
- JSON writing export; complete backups use the data directory.

No fictional personal entries are seeded. The outline supplies sections and prompts only. Photos and keepsakes come from your uploads. Writing autosaves after a short pause; **Save entry** also saves immediately. Untitled writing saves as “Untitled entry.” An untouched blank editor creates nothing. Conflicting edits from another tab stop autosave rather than overwrite newer writing.

## Run locally

Requires **Node.js 24.14 or later in the 24 LTS line**, including SQLite. There are no dependencies to install.

```sh
node server.js
```

Open `http://localhost:3000`, and write an entry. Local data goes into `./data`. Set `PORT` or `DATA_DIR` in the shell to override defaults. The plain Node server does not load `.env`; that example is for Compose.

```sh
npm run build
npm test
```

Build validates syntax; static assets are served directly. Tests cover password-free access for existing installations, cross-origin protection, validation, edits/stale versions, uploads, media ranges, export, deletion, and restart persistence. Tests use temporary synthetic data, never your journal.

## Docker and Unraid

See **[UNRAID.md](UNRAID.md)** for installation, Tailscale, updates, and backups.

- Image: `ghcr.io/charliec94/diary:latest`
- LAN port: `8083` → container `3000`
- Mount: `/mnt/user/appdata/diary` → `/data`
- Template: [`unraid/diary.xml`](unraid/diary.xml)
- Database: `/data/journal/journal.sqlite`
- Tailscale state: `/data/.tailscale_state`

GitHub Actions builds Linux amd64 for Unraid, runs app tests and container checks, then publishes. PRs validate without publishing. Actions must be enabled and its token allowed to write packages. Private GHCR packages require authenticated pulls. This setup does not change repository/package visibility.

## Privacy and limits

There is no app password: anyone who can reach its network address can read and edit the journal. Access is managed through your LAN/Tailscale network. Stored data and backups are **not encrypted at rest**. This is a single-owner journal without invitations, cloud sync, transcription, or an import interface. Media playback depends on browser codec support. Lists are loaded into memory for search, appropriate for a personal journal rather than a large multi-user archive.

The optional WebMCP tool `start_journal_entry` opens an editor in supporting browsers. Opening alone does not save; subsequent typing follows the same autosave flow. Browsers without that proposed API work normally.

## Development

`server.js` owns HTTP, SQLite, and attachments. `public/sections.js` shares the outline between server validation and UI. `public/app.js` provides the interface. SQL uses bound values and writing renders as text. Keep personal files, `.env`, databases, and Tailscale state out of Git and Docker build context.

### Upgrade from the password-protected version

Use the same data mount. Existing writing and attachments remain available immediately, without a password. Old authentication tables are left unused for a non-destructive upgrade. `COOKIE_SECURE` is obsolete and may be removed from existing container settings.

## Autosave, recovery, and your outline

Saved writing, topics, and attachment bytes stay in the existing `/data/journal/journal.sqlite` file under Unraid appdata. No backup scheduler was added: your existing Unraid appdata backup handles saved data.

While a save is pending, unfinished writing is also retained in this browser’s local storage. After a page close or connection failure, use **Unfinished writing → Resume** on the same browser and address. Successful saves clear that recovery copy. Offline drafts are device-local until synced; clearing browser storage removes them. If storage is unavailable, the editor reports that and warns before leaving unsaved writing. Failed network saves retry automatically; conflicts retain the draft for manual merging with the newer entry.

**Life outline** preserves the original ordering and distinguishes Travel destinations and Life Timeline chapter headings. Expand a section to browse a topic or press its plus button to write there. **Entry details → Outline topic** files existing entries without changing their text. Older entries retain their sections as general entries until you choose a topic. The source Markdown file stays local; the app preserves its section/topic structure.

Autosave uses serialized writes, version checks, and idempotent mutation IDs so retries after lost responses do not duplicate entries. Upgrades add only `topic` and `last_mutation` columns; existing writing and dates are preserved. Tests cover debounce, in-flight edits, response-loss recovery, conflicts, validation recovery, topic migration, and calendar matching.
