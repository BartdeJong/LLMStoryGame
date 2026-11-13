const CACHE_PREFIX = "cozy-mystery-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v13`;
const scopeUrl = new URL(self.registration.scope);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const shellResponse = await fetch(scopeUrl);
    if (!shellResponse.ok) throw new Error(`Could not cache the app shell (${shellResponse.status}).`);
    const shellText = await shellResponse.clone().text();
    await cache.put(scopeUrl, shellResponse);

    const buildManifestUrl = new URL(".vite/manifest.json", scopeUrl);
    const buildManifestResponse = await fetch(buildManifestUrl);
    if (!buildManifestResponse.ok) throw new Error(`Could not cache the app assets (${buildManifestResponse.status}).`);
    const buildManifest = await buildManifestResponse.json();
    const assetUrls = new Set();
    for (const entry of Object.values(buildManifest)) {
      if (entry.file) assetUrls.add(new URL(entry.file, scopeUrl).href);
      for (const path of [...(entry.css ?? []), ...(entry.assets ?? [])]) {
        assetUrls.add(new URL(path, scopeUrl).href);
      }
    }
    for (const match of shellText.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
      assetUrls.add(new URL(match[1], scopeUrl).href);
    }
    await cache.addAll([...assetUrls]);

    const indexUrl = new URL("stories/index.json", scopeUrl);
    const indexResponse = await fetch(indexUrl);
    if (!indexResponse.ok) throw new Error(`Could not cache story list (${indexResponse.status}).`);
    await cache.put(indexUrl, indexResponse.clone());
    const storyIndex = await indexResponse.json();
    const storyUrls = storyIndex.stories.map((story) => new URL(`stories/${encodeURIComponent(story.id)}.json`, scopeUrl));
    await cache.addAll(storyUrls);

    await cache.addAll([
      new URL("manifest.webmanifest", scopeUrl),
      new URL("icon.svg", scopeUrl),
      new URL("icon-180.png", scopeUrl),
      new URL("icon-192.png", scopeUrl),
      new URL("icon-512.png", scopeUrl),
      new URL("icon-maskable-512.png", scopeUrl),
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== scopeUrl.origin
    || !requestUrl.href.startsWith(scopeUrl.href)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Page loads and the story list go to the network first so a new deploy shows on the next visit;
    // the cached copy is only used when offline.
    const networkFirst = event.request.mode === "navigate"
      || requestUrl.pathname === new URL("stories/index.json", scopeUrl).pathname;
    if (networkFirst) {
      const cacheKey = event.request.mode === "navigate" ? scopeUrl : event.request;
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(cacheKey, response.clone());
        return response;
      } catch {
        const cachedCopy = await cache.match(cacheKey);
        if (cachedCopy) return cachedCopy;
        throw new Error("The app is not available offline.");
      }
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
