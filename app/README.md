# Replay application

Start with the [repository README](../README.md) for installation, browser support, backups and troubleshooting.

From the repository folder:

```sh
npm ci
npm start
```

Then open http://127.0.0.1:4317. For development, run `npm run dev` instead. Stop the other mode first.

Application source lives in `src/`; the local media service lives in `server/`. Optional private settings belong in `app/.env`. Recording data defaults to `app/.replay-data/` and is never included in the release package.

The [workflow reference](../docs/FEATURES.md) describes recording, editing, exports, analytics and isolated local viewer links.
