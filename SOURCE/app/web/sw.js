// Service worker: offline cache + cross-origin isolation.
//
// The analysis engine (YaneuraOu WASM) uses pthreads/SharedArrayBuffer, which
// require the page to be "crossOriginIsolated". On hosts where we can't set
// COOP/COEP response headers (e.g. inside the Capacitor Android WebView), this
// SW injects them — the well-known coi-serviceworker technique — while also
// serving the app shell cache-first for offline use.
const CACHE = 'shogi-trainer-general-v1'

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/app.css',
  './src/main.js',
  './src/questions.js',
  './src/questions.data.js',
  './src/shogi.js',
  './src/board.js',
  './src/movegen.js',
  './src/analysis.js',
  './src/store.js',
  './src/audio.js',
  './src/scheduler.js',
  './src/engine.js',
  './src/assets-manifest.js',
  './vendor/ts-fsrs.mjs',
  './vendor/capacitor-core.mjs',
]
// The 60MB engine wasm is intentionally NOT precached — it's fetched on demand
// (first analysis) and then runtime-cached below.

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function withCoi(res) {
  // Clone response with COOP/COEP added so the page becomes cross-origin isolated.
  const headers = new Headers(res.headers)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // The 60MB engine never changes between builds → cache-first (avoid re-download).
  const cacheFirst = url.pathname.includes('/vendor/engine/')

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      if (cacheFirst) {
        const hit = await cache.match(req)
        if (hit) return withCoi(hit)
        try {
          const res = await fetch(req)
          if (res.ok && res.type === 'basic') cache.put(req, res.clone())
          return withCoi(res)
        } catch {
          return withCoi((await cache.match(req)) || new Response('offline', { status: 503 }))
        }
      }
      // App shell: network-first so edits show on reload; fall back to cache offline.
      try {
        const res = await fetch(req)
        if (res.ok && res.type === 'basic') cache.put(req, res.clone())
        return withCoi(res)
      } catch {
        const hit = (await cache.match(req)) || (await cache.match('./index.html'))
        return withCoi(hit || new Response('offline', { status: 503 }))
      }
    })(),
  )
})
