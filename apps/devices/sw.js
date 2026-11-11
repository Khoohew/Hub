// Device Manager uses live GitHub API data; legacy worker self-removes.
self.addEventListener("install",event=>{
 event.waitUntil((async()=>{await self.skipWaiting();})());
});
self.addEventListener("activate",event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith("device-manager-shell-")).map(key=>caches.delete(key)));
  await self.registration.unregister();
  await self.clients.claim();
 })());
});
