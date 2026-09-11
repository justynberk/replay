# Replay

A local recording and editing studio based on the selected dark Cutroom design. Built for quick walkthroughs and reusable exports. Your source files, library and edit history stay on this computer.

## Open the app

Follow the [installation guide](../README.md). From the repo root, run `npm ci` once and `npm start` for each session. Open http://127.0.0.1:4317 after startup completes. This command serves the built owner UI and local API together, with the isolated viewer on 4319.

The initial project is an explicitly labelled illustrative sample with generated images. Narration is synthesized locally where available; other systems receive a silent sample. Import your own clip or choose Record to create a real recording.

## Implemented local workflows

- Screen, camera, microphone and available system-audio capture, source selection, input meter, private notes, countdown, pause/resume, review and save. Setup/record/save actions stay visible while source settings scroll. The browser remembers camera and microphone IDs only after successful setup, with a default-device fallback if those devices disappear.
- Separate camera, microphone and system tracks when captured. Browser recording chunks are saved to IndexedDB for interrupted-session recovery.
- Video import with real probing, thumbnails, waveform extraction and browser playback preparation. Original imported bytes remain preserved when conversion is necessary.
- Persistent grid/list library with quick Watch/Edit/Download actions, local view counts for the last 30 days, timestamped transcript search results, title/transcript/tag search, folders, favorites, archive/restore, duplicate and multi-selection. Stitch 2 to 10 selected recordings in a chosen order, with their saved edits and retimed captions.
- Recording review is the default landing page after recording, importing, or opening a library card. It shows the saved composition, editable summary, clickable chapters and optional resource links. Cutroom stays one click away, with Done editing returning to review.
- Reversible trim and range cuts, transcript passage cuts and text correction, preview seeking and edit version restoration. The inspector and timeline can be collapsed. Viewing speed is temporary and independent of the export speed in Audio.
- Camera positioning and sizing, landscape/portrait/square framing, text, arrow and box overlays, opaque privacy masks, caption import and timed caption display.
- Motion panel with up to 40 editable zoom regions, a visual focus picker, 1x to 3x magnification, smooth easing, timeline markers and optional camera shrinking. Zooms use original recording timestamps and survive cuts, undo, saved versions and export. Camera shrinking applies when the camera fits fully inside the output canvas.
- Independent microphone and app-audio volume controls when separate tracks are available. Recorder quality requests support 720p, 1080p or 4K and 30 or 60 fps, with actual source dimensions and frame rate shown after setup.
- Local silence detection with proposed cuts to review before applying. Volume adjustment and export loudness normalization.
- Private timestamped review notes, resolve/reopen, editable chapters and summaries.
- Real queued MP4, WebM, MP3, WAV, GIF, SRT, VTT, TXT, Markdown, PNG, JSON, original-source and ZIP exports. Outputs follow the saved edit. Captions and metadata are retimed after cuts and speed changes.
- Four delivery shortcuts: Video, Vertical clip, Audio and Complete package. Custom export presets, quality/resolution settings, caption burn-in, optional source files in packages, progress, cancellation, retry using the original export snapshot and file downloads.
- Local project links and portable handoff packages. These are clearly distinguished from hosted online sharing.
- Dedicated viewer links serve a rendered snapshot of the saved composition with a searchable transcript, chapters, summary, resource links and independent viewing speed, without editing controls. Analytics shows views, anonymous unique browsers, active watch time, average watch time, completion, daily activity, per-recording coverage and recent sessions. Includes 7/30/90-day filters, search, sorting and CSV downloads.

## Viewing analytics

Open **Analytics** from the library sidebar. Use **Share > Open watch page**, the recording menu, or a watch button in Analytics to start a viewing session. Opening a watch link alone does not count; tracking starts after at least 0.25 seconds of playback. Review and editor previews, downloaded files and external platforms are excluded.

A view is one watch-page session until navigation or reload. Replaying adds watch time to that session. Unique browsers use a random local browser identifier, with no viewer names or IP addresses stored; clearing site storage resets that identifier. Paused, buffered, hidden-tab and seek time is excluded. Completion means at least 90% of the finished timeline was actually watched, with repeat sections counted once. Coverage charts average the fraction watched in each 5% section. Each session retains its finished duration, so later edits do not change its completion calculation; coverage across different edits is compared by percentage of their finished timelines.

Dates use the browser's time zone and include today. All activity for a session belongs to its start date, including watch time accumulated after midnight. The dashboard refreshes every 15 seconds. Cumulative updates are sent every five seconds and on pauses or page exit, with idempotent retries. Abrupt browser/OS termination or an unavailable server can lose the last unsaved interval. These are local playback measurements, not proof of a person's attention or an identity system.

## AI configuration

AI is optional. No recording is sent to a provider on import or playback. The app only calls the configured provider when you explicitly use a transcription or summary action.

Copy `app/.env.example` to `app/.env`, configure `OPENAI_API_KEY` privately, and restart Replay. Never prefix secrets with `VITE_` or put keys into the browser. Transcription uses `whisper-1` for timed segments. Summaries use `REPLAY_AI_MODEL`, defaulting to `gpt-4.1-mini`. The health check reports whether a key is configured, not whether provider credentials, quota or output quality have been verified.

AI features are disabled when there is no key. Caption imports and manual transcript/summary edits work locally. There is no automatic provider fallback.

## Storage and recovery

The service stores data in `app/.replay-data/` by default. The library and separate `analytics.json` files are written atomically. Media sources and exported files are stored separately. Back up the entire directory, including `library.json`, `analytics.json` (created after the first view), `media/`, and `exports/`. Do not delete it to restart the app.

Recorder recovery drafts live in this browser's IndexedDB until saved or discarded. Clearing browser data also clears recovery drafts. A browser or operating-system interruption can still lose the most recent unsaved chunk, and damaged or incomplete media may require recovery. Do not treat the interface alone as proof of crash recovery under every failure mode.

## Current boundaries

This is a working local application, not full production Loom parity. Online hosting, multi-user authentication, cloud uploads, public audience and third-party platform analytics, meeting bots, calendar/provider integrations, native desktop/mobile applications, SSO/SCIM, regional storage and enterprise operations remain separate implementation tracks. Local watch-page analytics works on this computer; localhost links cannot be opened by another person over the internet.

Screen capture requires a supported browser and the user's screen/camera/microphone permissions. System sound support depends on browser and selected source. A browser cannot silently remember permission to share a screen. Native recorder parity and OS permission behavior require device testing.

Motion is manually directed. Automatic desktop click tracking and replacement cursors are not implemented. Requested recording resolution and frame rate are preferences, not guarantees. Exported motion uses the existing local FFmpeg service; preview and export can differ by a few pixels due to raster rounding.

Imports are limited to 4 GB per file. GIF exports are limited to two minutes. Export workers run one job at a time. Browser preview audio normalization is not applied live; the rendered export includes it. Color, captions and text may differ slightly between browser and native font rendering. An MP4 does not retain interactive comments or clickable CTAs; metadata travels in the package instead.

The bundled static Sites build is not a deployment of the local media service. A real cloud deployment needs a hosted backend and media workers, storage, authentication and access controls. Do not publish the static frontend and describe recording/export/cloud sharing as deployed.

## Development checks

- `npm run build`: production frontend build and preserved template hosting bundle.
- `npm test`: media/export integration tests, editing helper tests and template worker tests.
- `npm run test:sites`: static hosting template contract only, not backend verification.

See the [release checklist](RELEASE-CHECKLIST.md) for verification and browser testing.


## Viewer links and discussion

Share > Open watch page or Copy viewer link prepares an immutable MP4 with the saved cuts, motion, camera, captions and privacy masks. The first visitor sees preparation progress. Subsequent visits reuse that snapshot and discussion. Share > Disable link immediately denies new metadata, media, comments and activity requests for that link. Already downloaded video cannot be recalled. To share a newer edit, disable the old link and create another; the new snapshot has a new discussion.

The viewer uses a separate Express app on port 4319 and a separate frontend entry (`watch.html`). It has no account navigation and no library, settings, editing, export, source-media or owner analytics API routes. A random 256-bit link token grants access to exactly one finished video, its selected information, comments and activity submission. Invalid and revoked links fail closed. Private review notes and version history are never included. Original media is never served by the viewer, including footage removed by edits.

Comments use finished-video seconds. Focusing the comment field pauses playback and pins that moment; later seeking does not move a draft's timestamp. Use current time explicitly reanchors the draft. Comments and their timeline markers survive refresh, and other viewers' comments refresh every four seconds. Marker and timestamp buttons seek precisely to the comment and highlight it. Names are self-reported, comments are visible to anyone with the link, retries are idempotent, and discussion writes are bounded and rate limited. Viewer discussions are stored separately in `.replay-data/watch.json`; private editor notes remain private.

All listeners bind to loopback. These are local viewer links, not internet-hosted links or authenticated accounts. A public deployment must expose only the viewer service, configure `REPLAY_WATCH_ORIGIN` to its HTTPS origin, and keep the owner services private. Do not expose the owner Vite or API ports. The existing Sites package does not deploy this local viewer service. `npm run dev` builds the viewer entry at startup; after changing viewer UI during a session, run `npm run build` and reload it.

Verification: `tests/watch.test.mjs` uses real exports and separate HTTP listeners to check edited media, byte ranges from the hidden storage folder, metadata filtering, blocked owner routes, invalid tokens, timestamp validation, duplicate submission, persistence, frozen snapshots, analytics and revocation. Browser QA covered playback, a draft pinned at 13.716139 seconds while seeking back to zero, posting/reload, and marker seeking on the illustrative Motion studio demo.
