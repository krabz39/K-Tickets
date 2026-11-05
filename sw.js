const CACHE='kt-static-v1';
const STATIC=['/assets/kt-premium.css','/assets/kt-icon.svg','/manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
 if(STATIC.includes(u.pathname)){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));return;}
 // Do not cache customer/admin pages, payment endpoints, API responses, or authenticated data.
});
