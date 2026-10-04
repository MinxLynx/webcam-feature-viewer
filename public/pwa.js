const panel = document.getElementById('offlinePanel');
const status = document.getElementById('offlineStatus');
const update = document.getElementById('applyUpdate');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

async function cacheReady(worker) {
  if (!worker) return false;
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 5000);
    channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data?.ready === true); };
    worker.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]);
  });
}

export async function startOfflineSupport() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || (local && !new URLSearchParams(location.search).has('pwa-test'))) return;
  panel.hidden = false;
  try {
    const registration = await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: './', updateViaCache: 'none' });
    const showUpdate = () => { update.hidden = false; status.textContent = '新しい版をダウンロードしました。現在の作業を終えたら更新してください。'; };
    const watch = worker => {
      if (!worker) return;
      worker.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); });
    };
    watch(registration.installing);
    registration.addEventListener('updatefound', () => watch(registration.installing));
    if (registration.waiting) showUpdate();
    let applying = false;
    update.addEventListener('click', () => {
      if (!registration.waiting) return;
      applying = true;
      update.disabled = true;
      status.textContent = '更新しています…';
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
    const report = async () => {
      const ready = await cacheReady(navigator.serviceWorker.controller);
      panel.dataset.ready = String(ready);
      if (!registration.waiting) status.textContent = ready ? 'オフライン利用の準備ができました。ホーム画面に追加できます。' : 'オフライン準備中です。完了するまで通信を切らないでください。';
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applying) location.reload();
      else report();
    });
    await report();
    const check = () => { if (navigator.onLine) registration.update().catch(() => {}); };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    check();
  } catch {
    panel.dataset.ready = 'false';
    status.textContent = 'オフライン準備ができませんでした。通信を確認し、ページを再読み込みしてください。';
  }
}
