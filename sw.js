/* Guarda el juego en el celular para que abra rápido y funcione sin conexión contra la compu */
const CACHE = "choque-web-v19";
const FILES = ["bien.mp3", "bocina.mp3", "bomba.mp3", "burbuja.mp3", "choque.mp3", "escudo.mp3", "fin.mp3", "fuego.mp3", "gameover.mp3", "hielo.mp3", "mal.mp3", "swish.mp3", "tac.mp3", "tecla.mp3", "terremoto.mp3", "tic.mp3", "jugar.html", "palabras.txt", "comunes.txt", "supabase.js", "online.js", "online-config.js", "archivo-wdth.woff2", "instrument-sans-400.woff2", "instrument-sans-500.woff2", "instrument-sans-600.woff2", "instrument-sans-700.woff2", "icono-180.png", "icono-192.png", "icono-512.png", "manifest.webmanifest"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("choque-web-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const name = u.pathname.split("/").pop() || "";
  if (!FILES.includes(name)) return;
  if (name === "jugar.html") {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
