const CACHE_PREFIX = "cozy-mystery-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
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
    if (event.request.mode === "navigate") {
      const cachedShell = await cache.match(scopeUrl);
      const update = fetch(event.request).then(async (response) => {
        if (response.ok) {
          try {
            await cache.put(scopeUrl, response.clone());
          } catch (error) {
            console.warn("Could not update the cached app shell.", error);
          }
        }
        return response;
      }).catch(() => undefined);
      if (cachedShell) return cachedShell;
      const response = await update;
      if (response) return response;
      throw new Error("The app shell is not available offline.");
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
