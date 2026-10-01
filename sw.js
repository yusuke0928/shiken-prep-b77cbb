// sw.js — 柏原市 採用試験対策 一式（オフライン閲覧用）
//
// 方針：
//  - cache-first ＋ バックグラウンド更新（stale-while-revalidate）。
//    キャッシュがあれば即座に返し、裏で最新版を取りに行って次回用に保存する。
//  - skipWaiting() は無条件では呼ばない。ページ側から SKIP_WAITING メッセージが
//    届いたときだけ呼ぶ（学習中に中身が急に入れ替わって混乱しないように）。
//  - バージョンを変えたら CACHE_VERSION を上げる。古いキャッシュは activate で削除。

const CACHE_VERSION = 'kashiwara-v5.20261001';

const PRECACHE_URLS = [
  './',
  './index.html',
  './scoa-trainer.html',
  './kashiwara-senko-taisaku.html',
  './kashiwara-kojin-mensetsu-qa.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // 注意：skipWaiting() はここでは呼ばない。新しいSWは activate されるまで待機する。
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ページ側の「再読み込み」ボタンが押されたときだけ、待機中のSWを有効化する。
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return; // 外部通信は扱わない

  event.respondWith(cacheFirstWithRevalidate(req));
});

async function cacheFirstWithRevalidate(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });

  const networkFetch = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    // オフラインでも必ず開けるよう、まずキャッシュを即返す。
    // 更新は裏で進め、成功すれば次回アクセス時に反映される。
    networkFetch.catch(() => {});
    return cached;
  }

  const fresh = await networkFetch;
  if (fresh) return fresh;

  // キャッシュ未登録・ネットワークも失敗（オフライン初回アクセス等）の最終フォールバック。
  // ナビゲーション（ページ遷移）はキャッシュ済みのトップページを返し、真っ白にしない。
  if (req.mode === 'navigate') {
    return (await cache.match('./index.html', { ignoreSearch: true })) || Response.error();
  }
  return Response.error();
}
