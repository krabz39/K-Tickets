# K-Tickets hotfix notes

## Fixes included
1. Landing-page text contrast corrected for light ivory/cream surfaces; hero card text is explicitly dark and footer text remains light on green.
2. `customer/my-tickets.html` now selects `events.image_url` instead of the nonexistent `events.cover_image_url`.
3. `customer/ticket.html` now selects and reads `events.image_url`.
4. Fixed the ticket page JavaScript parse failure: PWA registration/app-install script had been inserted inside the `buildDownloadHtml()` template string, prematurely terminating the page's executable script. It is now placed at the real document end. Extracted JavaScript syntax checks pass.
5. Added `mobile-web-app-capable` alongside the iOS-specific meta tag.
6. Added `vercel.json` static headers for manifest and service worker MIME types/cache behavior.

## Vercel SSO / manifest warning
The console shows Vercel redirecting `/manifest.webmanifest` to `/sso-api`. That is Vercel Deployment Protection, not a browser CORS setting. The code cannot bypass that protection. Deploy to the production domain/alias with public access, or adjust Vercel Project Settings → Deployment Protection for the deployment. Then verify this URL returns HTTP 200 and JSON directly:
`https://YOUR-PUBLIC-DOMAIN/manifest.webmanifest`

Do not add `Access-Control-Allow-Origin: *` as a workaround for an SSO redirect. The manifest is same-origin and should be served directly.

## Deploy
Deploy the contents of this project to Vercel. Ensure `manifest.webmanifest`, `sw.js`, `vercel.json`, and `assets/` are at the deployed project root. Clear/refresh the browser cache after deployment. Test ticket viewing while signed in, including QR rendering, download, print, event details, and realtime updates.
