/* K-Tickets PWA shell. Payment/API requests are never cached. */
const CACHE='k-tickets-shell-v1';
const SHELL=['/','/index.html','/manifest.webmanifest','/assets/k-tickets-ui.css','/assets/icon-192.svg','/assets/icon-512.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;
  if(url.pathname.startsWith('/functions/')||url.pathname.includes('/rest/v1/')||url.pathname.includes('/auth/v1/')) return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}return response;}).catch(()=>caches.match(req).then(cached=>cached||caches.match('/index.html'))));
    return;
  }
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}return response;})));
});
