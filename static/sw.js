// ClubMusic Service Worker
const CACHE_VERSION = 'v1';
const CACHE_NAME = `clubmusic-${CACHE_VERSION}`;

// 需要缓存的静态资源
const STATIC_ASSETS = [
  '/',
  '/static/css/base.css',
  '/static/css/theme-dark.css',
  '/static/css/theme-light.css',
  '/static/css/responsive.css',
  '/static/css/settings.css',
  '/static/js/main.js',
  '/static/js/api.js',
  '/static/js/player.js',
  '/static/js/playlist.js',
  '/static/js/playlists-management.js',
  '/static/js/ui.js',
  '/static/js/utils.js',
  '/static/js/volume.js',
  '/static/js/search.js',
  '/static/js/local.js',
  '/static/js/debug.js',
  '/static/js/i18n.js',
  '/static/js/themeManager.js',
  '/static/js/settingsManager.js',
  '/static/js/navManager.js',
  '/static/js/templates.js',
  '/static/js/operationLock.js',
  '/static/images/preview.png',
  '/static/images/icon-192.png',
  '/static/images/icon-512.png'
];

// Service Worker 安装事件
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中...', CACHE_NAME);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] 缓存静态资源');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] 安装完成');
        return self.skipWaiting(); // 立即激活新的 Service Worker
      })
      .catch(err => {
        console.error('[SW] 安装失败:', err);
      })
  );
});

// Service Worker 激活事件
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...', CACHE_NAME);
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        // 删除旧版本缓存
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('clubmusic-') && name !== CACHE_NAME)
            .map(name => {
              console.log('[SW] 删除旧缓存:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] 激活完成');
        return self.clients.claim(); // 立即控制所有页面
      })
  );
});

// Fetch 事件 - 网络优先策略（适合动态内容）
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // 跳过跨域请求
  if (url.origin !== location.origin) {
    return;
  }
  
  // API 请求：网络优先，失败时返回错误
  if (url.pathname.startsWith('/api/') || 
      url.pathname === '/status' || 
      url.pathname === '/playlist' ||
      url.pathname.startsWith('/playlists')) {
    event.respondWith(
      fetch(request)
        .catch(err => {
          console.error('[SW] API 请求失败:', url.pathname, err);
          return new Response(JSON.stringify({ error: 'Network error' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }
  
  // 静态资源：缓存优先，失败时从网络获取
  event.respondWith(
    caches.match(request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // 返回缓存，同时后台更新
          fetch(request)
            .then(response => {
              if (response.ok) {
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(request, response);
                });
              }
            })
            .catch(() => {}); // 静默失败
          
          return cachedResponse;
        }
        
        // 缓存未命中，从网络获取
        return fetch(request)
          .then(response => {
            // 只缓存成功的响应
            if (response.ok && request.method === 'GET') {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, responseToCache);
              });
            }
            return response;
          });
      })
  );
});

// 消息事件 - 用于手动控制缓存
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(name => caches.delete(name))
        );
      })
    );
  }
});
