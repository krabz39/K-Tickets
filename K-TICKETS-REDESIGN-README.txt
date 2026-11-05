K-TICKETS VISUAL REDESIGN + PWA FOUNDATION

This update applies a shared premium visual theme to the existing HTML pages.
It preserves the existing page scripts, Supabase calls, payment integrations,
ticket issuance, QR verification, role checks, and database logic.

Visual direction:
- Burgundy cinematic landing experience
- Cream/paper surfaces and deep-green navigation
- Event photography backgrounds on discovery/featured areas
- Premium cards, forms, checkout and ticket surfaces
- Responsive spacing and touch targets for mobile/tablet/desktop
- PWA manifest, icons and minimal static-asset service worker

DEPLOY:
1. Back up your current project.
2. Replace the project files with this package, or merge the changed HTML files,
   assets/kt-redesign.css, manifest.webmanifest and sw.js.
3. Keep your existing Supabase project settings and secrets unchanged.
4. Deploy to HTTPS.
5. Open the root website in Chrome/Edge or Safari and install/add to Home Screen.

IMPORTANT:
The CSS uses remote Unsplash event photography URLs. Internet access is needed
to load those photos. Replace with licensed event photography in your own
assets folder before production if preferred.
This is a visual layer and PWA foundation, not a certification of payment
or production functionality. Test all flows on staging before release.
