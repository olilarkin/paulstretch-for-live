// Cross-Origin Isolation polyfill for hosts that can't set COOP/COEP headers
// (e.g. GitHub Pages). The page registers this worker once, reloads, and from
// then on every response is re-served with the headers required to unlock
// SharedArrayBuffer / crossOriginIsolated.
//
// Based on https://github.com/gzuidhof/coi-serviceworker (MIT).

let coepCredentialless = false;

if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.type === 'deregister') {
      self.registration
        .unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((c) => c.navigate(c.url)));
    } else if (ev.data.type === 'coepCredentialless') {
      coepCredentialless = ev.data.value;
    }
  });

  self.addEventListener('fetch', (event) => {
    const r = event.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

    const request = coepCredentialless && r.mode === 'no-cors'
      ? new Request(r, { credentials: 'omit' })
      : r;

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) return response;

          const headers = new Headers(response.headers);
          headers.set(
            'Cross-Origin-Embedder-Policy',
            coepCredentialless ? 'credentialless' : 'require-corp',
          );
          if (!coepCredentialless) {
            headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
          }
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        })
        .catch((e) => console.error(e)),
    );
  });
} else {
  (() => {
    if (window.crossOriginIsolated !== false) return;
    if (!window.isSecureContext) {
      console.warn('[coi] secure context required, not registering');
      return;
    }

    navigator.serviceWorker
      .register(window.document.currentScript.src)
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          console.log('[coi] update found, reloading');
          window.location.reload();
        });
        if (registration.active && !navigator.serviceWorker.controller) {
          console.log('[coi] activating, reloading');
          window.location.reload();
        }
      })
      .catch((err) => console.error('[coi] register failed', err));
  })();
}
