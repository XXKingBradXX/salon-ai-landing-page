# Empire Automations Salon AI Landing Page

A production-ready marketing landing page for Empire Automations' “AI Receptionist for Salons” offering. It includes a secure Cloudflare Worker proxy to forward demo requests to n8n without exposing the underlying webhook.

## Prerequisites

- Cloudflare account with access to Workers
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed locally (`npm install -g wrangler`)
- Hosting option for the static landing page (Cloudflare Pages, GitHub Pages, or existing hosting)

## Project structure

```
index.html                # Landing page hosted at https://www.empireautom.org/landing-page
workers/lead-proxy/       # Cloudflare Worker proxy code
  worker.js
wrangler.toml             # Wrangler configuration binding the worker to /api/lead
README.md                 # This file
```

## Configure the landing page

1. Open `index.html`.
   - `window.APP_CONFIG` exposes `DEMO_VIDEO_URL`, `TURNSTILE_SITE_KEY` (left blank while bot checks are disabled), and `SUBMIT_URL`.
2. Host `index.html` at `https://www.empireautom.org/landing-page` using Cloudflare Pages or your preferred static hosting service.
2. Confirm the Turnstile site key in `index.html` is set to `0x4AAAAAAB771F457k4Zdex3` (update it here if you rotate keys in the Turnstile dashboard).
3. Host `index.html` at `https://www.empireautom.org/landing-page` using Cloudflare Pages or your preferred static hosting service.

## Deploy the Cloudflare Worker proxy

1. Authenticate Wrangler with your Cloudflare account:
   ```bash
   wrangler login
   ```
2. Set the secrets required by the worker:
   ```bash
   wrangler secret put N8N_WEBHOOK_URL
   ```
   - Paste `https://n8n.empireautom.org/webhook-test/424f7cfd-5ed8-42b8-9382-4ac54e832174` when prompted for `N8N_WEBHOOK_URL`.
3. Update the `ALLOWED_ORIGIN` variable in `wrangler.toml` so it lists every host that will submit the form (comma-separated). The default configuration includes both the production domain and the Cloudflare Pages preview domain. If you leave the variable blank, the worker will automatically echo the incoming request origin.
4. Deploy the worker:
   ```bash
   wrangler publish
   ```
5. Confirm the route `https://www.empireautom.org/api/lead` is active on your zone. Wrangler uses the route defined in `wrangler.toml` to bind the worker automatically.

## Local preview (optional)

To test the worker locally with Wrangler:
```bash
wrangler dev workers/lead-proxy/worker.js
```
The dev server will expose the `/api/lead` endpoint for local testing. Use a tool such as `curl` or `httpie` to simulate requests.

## Troubleshooting on Cloudflare Pages

- In **Pages → Project → Settings → Functions & Build**, ensure no transforms or optimizations reorder or strip `<script>` tags.
- In the Cloudflare dashboard, disable **Rocket Loader** for `landingpage.empireautom.org` if it inherits the zone setting.
- If global **Auto-Minify** (HTML/JS) is enabled, add a Page Rule (or Ruleset) to exclude `landingpage.empireautom.org/*` or choose **Disable Performance** for this hostname so script execution order is preserved.

## Troubleshooting on Cloudflare Pages

- In **Pages → Project → Settings → Functions & Build**, ensure no transforms or optimizations reorder or strip `<script>` tags.
- In the Cloudflare dashboard, disable **Rocket Loader** for `landingpage.empireautom.org` if it inherits the zone setting.
- If global **Auto-Minify** (HTML/JS) is enabled, add a Page Rule (or Ruleset) to exclude `landingpage.empireautom.org/*` or choose **Disable Performance** for this hostname so script execution order is preserved.

## Testing checklist

- Form submission hits `https://www.empireautom.org/api/lead` and responds with `{ "ok": true }` on success.
- Response headers echo the requesting origin in `Access-Control-Allow-Origin` (e.g. `https://landingpage.empireautom.org`).
- Rapid submissions (20+ within 60 seconds) from the same IP return HTTP 429 rate-limit responses.
- Filling the hidden honeypot field (`website`) results in a silent success without forwarding to n8n.
- Successful submissions display the success message and reset the form state.

## Maintenance tips

- Update marketing copy or sections directly in `index.html`.
- Adjust rate-limiting thresholds or CORS behaviour inside `workers/lead-proxy/worker.js` if your requirements change.
- When rotating n8n webhook URLs, update the corresponding secret using `wrangler secret put` and redeploy.
