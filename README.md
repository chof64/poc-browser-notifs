# Push POC — Web Push + PWA on Cloudflare

Vanilla-JS PWA + single Cloudflare Worker (static assets + `/api` push routes) + KV subscription store. No build step, zero runtime deps (`wrangler` is the only dev dependency).

Demo: enable notifications → subscribe → **Send to this device** / **Send to all** → notification arrives even with the tab closed → tap opens the URL.

## Run locally

```bash
npm install
npm run gen:keys -- --write   # writes .dev.vars (gitignored)
npm run dev                   # wrangler dev, serves PWA + API
```

`gen:keys --write` is the easiest setup. To fill the file manually, copy `.dev.vars.example` (or `.env.example`) to `.dev.vars` and set the VAPID values there. Open the printed URL, allow notifications, subscribe, send.

> Push needs a real push service + VAPID; `wrangler dev` works in desktop Chrome/Edge.

## Deploy (dashboard Git, Cloudflare Workers + Assets)

1. Push this branch to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Connect to Git** → pick the repo/branch.
   - Build command: none
   - Deploy command: `npx wrangler deploy` (or leave the default; `wrangler.toml` drives it)
3. **KV binding**: `wrangler.toml` already declares the binding as `PUSH_SUBS` and points it at the `poc_browser_notifs` namespace. Git deploys apply that config, so you do not need a duplicate dashboard binding. The checked-in namespace ID is account-specific; if the namespace lives in another Cloudflare account, create your own with `npm run cf:kv:create` and replace the `[[kv_namespaces]] id` value in `wrangler.toml`. If you prefer dashboard-managed bindings, remove the `[[kv_namespaces]]` block and create a binding named `PUSH_SUBS` pointing at `poc_browser_notifs`.
4. **Settings → Variables and Secrets**:
   - `VAPID_PUBLIC_KEY` — variable, output of `npm run gen:keys`
   - `VAPID_SUBJECT` — variable, e.g. `mailto:you@example.com`
   - `VAPID_PRIVATE_KEY` — secret, output of `npm run gen:keys`
   `wrangler.toml` contains a commented `[vars]` example for the public key and subject; leave it commented while using dashboard values. Uncommenting it makes those config values override same-name dashboard values on deploy. `keep_vars = true` only preserves dashboard vars that are absent from the config. Secrets are never deleted by Wrangler.
5. Redeploy. Open `https://<worker>.workers.dev` on desktop/Android. On iPhone/iPad, open it in Safari, add it to the Home Screen, then launch it from the Home Screen — iOS only delivers push to the installed PWA.

For CLI deploys, run `npm run deploy`. Set the public key and subject as dashboard variables, or uncomment the placeholder `[vars]` block in `wrangler.toml` and replace it with real values if you are not managing them in the dashboard. Set the private key with the dashboard or `npx wrangler secret put VAPID_PRIVATE_KEY`. Only run `npm run cf:kv:create` if you are creating a new KV namespace; then replace the `PUSH_SUBS` ID in `wrangler.toml`. The checked-in ID is `6b91dda794934a9d9be519ce215b3622`.

## API

- `GET /api/health` → `{ ok, hasKv, hasVapidPublic, hasVapidPrivate, subject }`
- `GET /api/vapid-public-key` → `{ publicKey }`
- `POST /api/subscriptions` `{ subscription, meta }` → `{ ok, id }`
- `DELETE /api/subscriptions?endpoint=` → `{ ok }`
- `GET /api/subscriptions/count` → `{ count }`
- `POST /api/send` `{ target: 'self'|'all', subscription?, title, body, url }` → `{ ok, results, pruned }` (410/404 endpoints auto-pruned)

Validation errors return `{ error }` with 400; a self-send without a subscription returns 400, and an all-devices send with no saved subscriptions returns 404. A missing VAPID public key on `/api/vapid-public-key` returns 500.

## Brave notes

- `Subscribe failed: Registration failed - push service error` in Brave is browser-level (push service unreachable; VAPID/Worker not involved). Desktop Chrome/Edge need no extra setup; Brave needs the setting below; only iOS requires the installed PWA.
- The app detects Brave on this error and prints the fix in the delivery log. Keep `public/app.js` as the canonical wording.

## iOS notes

- Requires iOS/iPadOS 16.4+, the app **installed** via Safari Share → Add to Home Screen, then opened from the home screen. Browser-tab push does not work on iOS.
- Apple exposes no `beforeinstallprompt`, so the **Install app** button becomes **Add to Home Screen** on iOS and opens a steps sheet (Share → Add to Home Screen → Add → open from Home Screen → Enable + Subscribe inside the installed app). It can never auto-trigger the iOS install dialog.
- The steps sheet auto-opens once per session (with a “Don't auto-show” checkbox) and includes **Share this app** / **Copy link** actions. Installing still requires Safari's own Share → Add to Home Screen.
- The app detects iPadOS desktop-mode UAs and gates Subscribe with an explanation when not running standalone.

## Files

- `public/` — PWA shell (`index.html`, `app.js`, `sw.js`, manifest, icons, offline page)
- `src/worker.js` — Worker + Web Push (VAPID + RFC 8291 `aes128gcm`, WebCrypto, no deps) + `PUSH_SUBS` KV store
- `wrangler.toml` — Worker name, static assets, `PUSH_SUBS` KV binding, `keep_vars`
- `scripts/gen-vapid.mjs` — VAPID key generator; `scripts/make-icons.mjs` — placeholder icon generator
- `scripts/check-ios-detect.mjs` — `npm run check:ios` verifies iPhone/iPad detection
