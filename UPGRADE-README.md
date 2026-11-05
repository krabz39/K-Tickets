# K-Tickets Full Balanced UI + PWA Upgrade

This package is based on the uploaded K-HUB project.

## What changed
- Added `assets/kt-premium.css`: shared responsive visual layer using the approved burgundy, forest-green, cream and ivory palette.
- Added cinematic event photography backgrounds and customer event-card imagery (loaded from Unsplash; internet required).
- Added responsive refinements for mobile/tablet/desktop, safer touch targets, improved focus states and reduced-motion support.
- Added `manifest.webmanifest`, `assets/kt-icon.svg`, and `sw.js` for installable PWA support.
- Added `assets/kt-app.js` to surface the browser's native install prompt (and iOS Add to Home Screen guidance).
- Added `offline.html` as a basic offline information page.

## Backend and payment preservation
No Supabase Edge Function, database migration, payment callback, transaction function, QR verification logic, ticket issuance logic, or application business JavaScript was intentionally edited. The visual layer is loaded separately. The two existing M-Pesa Edge Function source files are included unchanged.

The service worker deliberately does NOT cache authenticated HTML, admin/merchant/customer data, payment requests, API responses, or tickets. This avoids serving stale or sensitive data offline. A ticket PDF explicitly downloaded by a customer remains under the device/browser's normal download handling.

## Deploy
1. Back up the currently deployed project.
2. Extract the contents of `K-HUB/` into the same web root as your current application. Keep the existing folder structure.
3. Ensure `assets/`, `manifest.webmanifest`, `sw.js`, and `offline.html` are served from the domain root.
4. Deploy to a staging domain over HTTPS first.
5. Test customer registration/login, event discovery, event detail, checkout, M-Pesa STK, WAMD, callback confirmation, ticket issuance/download, QR scan, merchant workflows, admin workflows and role permissions.
6. After successful testing, deploy to production.

The PWA paths use `/` as the application root. If hosting under a subdirectory rather than the domain root, update the manifest scope/start_url, service-worker registration and asset URLs accordingly.

## Home-screen installation
- Android/Chrome: open the HTTPS site and use Install app / Add to Home screen.
- iPhone/iPad: open in Safari, tap Share, then Add to Home Screen.

## Notes
- Event photography is remote Unsplash imagery and requires connectivity. Replace with approved/licensed local event imagery before production if preferred.
- This is a visual/PWA enhancement package, not a claim that every device/payment integration has been end-to-end tested in your hosting environment.
