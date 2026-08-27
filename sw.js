/* Service worker — Combate a Incêndio Papirus (v3)
   Deixa o app abrir sem conexão e avisa vencimentos em segundo plano. */
const CACHE="incendio-v15";
self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["/"])).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!=="venc-data").map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));});
/* Notificação diária de vencimentos (Chrome/Android com o app instalado) */
self.addEventListener("periodicsync",e=>{
  if(e.tag!=="venc-diaria")return;
  e.waitUntil((async()=>{
    try{
      const c=await caches.open("venc-data");
      const r=await c.match("/venc.json");if(!r)return;
      const d=await r.json();
      if(d.qtd>0)await self.registration.showNotification("🧯 Combate a Incêndio — Papirus",{
        body:`⚠️ ${d.qtd} equipamento(s) com manutenção vencida. Abra a aba Vencimentos.`,
        icon:"/icon-192.png",badge:"/icon-192.png",tag:"venc"});
    }catch(e){}})());});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:"window"}).then(ws=>ws.length?ws[0].focus():clients.openWindow("/")));});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);
  if(u.hostname.includes("firestore.googleapis.com")||
     u.hostname.includes("identitytoolkit.googleapis.com")||
     u.hostname.includes("securetoken.googleapis.com")||
     u.hostname.includes("generativelanguage.googleapis.com"))return;
  if(e.request.mode==="navigate"){
    e.respondWith(fetch(e.request)
      .then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put("/",cp));return r;})
      .catch(()=>caches.match("/")));
    return;}
  e.respondWith(caches.match(e.request).then(hit=>{
    const net=fetch(e.request).then(r=>{
      if(r.ok||r.type==="opaque"){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));}
      return r;}).catch(()=>hit);
    return hit||net;}));});
