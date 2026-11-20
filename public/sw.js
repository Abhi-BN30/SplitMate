const CACHE='splitmate-shell-v2';
const STATIC_PREFIXES=['/_next/static/','/icons/'];
const SHELL_PATHS=new Set(['/','/manifest.webmanifest']);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/','/manifest.webmanifest'])));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;
 const url=new URL(event.request.url);
 if(url.pathname.startsWith('/api/'))return;
 const isShell=SHELL_PATHS.has(url.pathname),isStatic=STATIC_PREFIXES.some(prefix=>url.pathname.startsWith(prefix));
 if(!isShell&&!isStatic)return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
  return response;
 }).catch(()=>caches.match(event.request).then(cached=>cached||(event.request.mode==='navigate'?caches.match('/'):undefined))));
});
