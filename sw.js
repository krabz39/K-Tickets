const CACHE='kt-static-v2';
const SHELL=['/assets/kt-redesign.css','/assets/kt-icon-192.png','/assets/kt-icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 if(event.request.method!=='GET'||u.origin!==location.origin)return;
 if(SHELL.includes(u.pathname))event.respondWith(caches.match(event.request).then(r=>r||fetch(event.request)));
});
