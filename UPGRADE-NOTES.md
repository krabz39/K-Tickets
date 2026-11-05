# K-Tickets UI + PWA upgrade

## What changed
- Added `assets/k-tickets-ui.css`, a presentation-only responsive layer for consistent spacing, typography, touch targets, event cards, forms, and horizontal table scrolling.
- Added `manifest.webmanifest`, app icons, and `sw.js` for installable Progressive Web App support.
- Linked the shared visual layer and PWA metadata from all 54 customer, admin, merchant, gate, and authentication HTML pages.
- Added service-worker registration to those pages.

## What was intentionally not changed
- Supabase schema, migrations, RLS policies, Edge Functions, payment callbacks, M-Pesa STK flow, WAMD flow, ticket issuance, QR validation, role checks, and application JavaScript were not edited.
- The service worker does not cache POST requests, Supabase REST/auth/function requests, or cross-origin API calls.

## Deploy
1. Back up the currently deployed project.
2. Upload the contents of this folder to the same web root, preserving the existing directory structure.
3. Deploy over HTTPS. PWA installation and service workers require HTTPS (localhost is also supported for development).
4. Open the site in Chrome/Edge on Android or desktop and use **Install app** / **Add to Home screen**. On iPhone, use Safari → Share → Add to Home Screen.
5. After deploying a later UI release, increment the cache name in `sw.js` (for example `k-tickets-shell-v2`) so installed clients refresh the shell.

## Important
This is a first responsive presentation pass layered over the supplied HTML. It deliberately avoids rewriting page-specific layouts or JavaScript because that could alter existing behavior. Review the main flows on staging before production, especially payment, QR scanning, and role-specific navigation. The illustrative values in the visual mockup are not inserted into the live app.
