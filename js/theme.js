// 深色與淺色外觀。放在 <head> 裡、不用 module，畫面畫出來之前就決定好，避免閃一下白底。
// 沒選過時跟著系統設定；選過就記在這台裝置的瀏覽器裡（只記 light 或 dark，不含任何個人資料）。
(function () {
  var KEY = 'traceback-theme';
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

  function current() {
    if (root.dataset.theme) return root.dataset.theme;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function label(btn) {
    var dark = current() === 'dark';
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.setAttribute('aria-label', dark ? '改成淺色外觀' : '改成深色外觀');
    btn.title = dark ? '改成淺色外觀' : '改成深色外觀';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-btn');
    if (!btn) return;
    label(btn);
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch (e) {}
      label(btn);
    });
    if (window.matchMedia) {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { label(btn); });
    }
  });
})();
