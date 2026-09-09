// CodeSandbox Nodebox Service Worker Shim
// Ensures that /__nodebox__/sw.js always returns 200 OK without 404

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through standard fetches
});
