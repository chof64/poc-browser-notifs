# Push POC — Web Push + PWA on Cloudflare

Vanilla-JS PWA + single Cloudflare Worker (static assets + `/api` push routes) + KV subscription store. No build step, zero runtime deps.

Demo: enable notifications → subscribe → **Send to this device** / **Send to all** → notification arrives even with the tab closed → tap opens the URL.

## Run locally

```bash
npm install
npm run gen:keys -- --write   # writes .dev.vars (gitignored)
npm run dev                   # wrangler dev, serves PWA + API
```

Open the printed URL, allow notifications, subscribe, send.

> Push needs a real push service + VAPID; `wrangler dev` works in desktop Chrome/Edge.

## Deploy (dashboard + git, Cloudflare Workers + Assets)

1. Push this branch to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Connect to Git** → pick the repo/branch.
   - Build command: none (or `npm run make:icons` if you delete icons)
   - Deploy command: `npx wrangler deploy` (or leave default; `wrangler.toml` drives it)
3. **Bindings → KV**: Type `KV namespace`, Name `KV_BINDING`, Value `poc_browser_notifs`. For CLI deploys only, copy its ID into `wrangler.toml` (`[[kv_namespaces]] id`); dashboard Git deploys use the dashboard binding.
4. **Settings → Variables**: add secrets (encrypt the private one):
   - `VAPID_PUBLIC_KEY` = output of `npm run gen:keys`
   - `VAPID_PRIVATE_KEY` = output of `npm run gen:keys` (secret)
   - `VAPID_SUBJECT` = `mailto:you@example.com`
5. Redeploy. Open `https://<worker>.workers.dev` anywhere (desktop + Android + iOS Safari).

Alternatively via CLI: `npm run cf:kv:create`, paste the ID, `wrangler secret put VAPID_PRIVATE_KEY`, `wrangler deploy`.

## API

- `GET /api/health` → `{ ok, hasVapidPublic, hasVapidPrivate }`
- `GET /api/vapid-public-key` → `{ publicKey }`
- `POST /api/subscriptions` `{ subscription, meta }` → `{ ok, id }`
- `DELETE /api/subscriptions?endpoint=` → `{ ok }`
- `GET /api/subscriptions/count` → `{ count }`
- `POST /api/send` `{ target: 'self'|'all', subscription?, title, body, url }` → `{ ok, results, pruned }` (410/404 endpoints auto-pruned)

## Brave notes

- `Subscribe failed: Registration failed - push service error` in Brave is browser-level (push service unreachable; VAPID/Worker not involved). Desktop tab is fine — only iOS needs the installed PWA.
- The app detects Brave on this error and prints the fix in the delivery log. Keep `public/app.js` as the canonical wording.

## iOS notes

- Requires iOS/iPadOS 16.4+, the app **installed** via Safari Share → Add to Home Screen, then opened from the home screen. Browser-tab push does not work on iOS.
- Apple exposes no `beforeinstallprompt`, so the **Install app** button becomes **Add to Home Screen** on iOS and opens a steps sheet (Share → Add to Home Screen → Add → open from Home Screen → Enable + Subscribe inside the installed app). It can never auto-trigger the iOS install dialog.
- The app detects iPadOS desktop-mode UAs and gates Subscribe with an explanation when not running standalone.

## Files

- `public/` — PWA shell (`index.html`, `app.js`, `sw.js`, manifest, icons, offline page)
- `src/worker.js` — Worker + Web Push (VAPID + RFC 8291 `aes128gcm`, WebCrypto, no deps) + KV store
- `scripts/gen-vapid.mjs` — VAPID key generator; `scripts/make-icons.mjs` — placeholder icon generator
- `scripts/check-ios-detect.mjs` — `npm run check:ios` verifies iPhone/iPad detection
