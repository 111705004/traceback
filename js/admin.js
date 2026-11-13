// 管理員：審核登錄者、人工確認官方帳號。
import { api, ACTIVITIES, $, esc, setStatus, setLine, accountLink, fmtTime } from './api.js';

const token = () => $('admin-token').value.trim();

async function load() {
  // 只記在這個分頁，關掉就忘記
  try {
    sessionStorage.setItem('tb-admin', token());
  } catch (_) {
    /* 無法使用儲存空間 */
  }
  setStatus('讀取中');
  try {
    const kols = await api(`/api/admin/kols?status=${$('filter').value}`, { token: token() });
    setLine('admin-result', `共 ${kols.length} 位`, 'ok');
    render(kols);
  } catch (err) {
    setLine('admin-result', err.message, 'bad');
    $('kols').innerHTML = '';
  } finally {
    setStatus('');
  }
}

function render(kols) {
  const list = $('kols');
  list.innerHTML = '';
  for (const k of kols) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="inbox-body">
        <strong>${esc(k.display_name)}${k.title ? `（${esc(k.title)}）` : ''}</strong>
        <dl class="record">
          <dt>登錄時間</dt><dd>${esc(fmtTime(k.created_at))}</dd>
          <dt>臉部特徵</dt><dd>${k.faces} 組</dd>
          <dt>民眾回報</dt><dd>${k.reports} 則</dd>
          <dt>聲明不會</dt><dd>${k.never.map((n) => esc(ACTIVITIES[n.key])).join('、') || '沒有'}</dd>
          ${k.note ? `<dt>說明</dt><dd>${esc(k.note)}</dd>` : ''}
        </dl>
        <ul class="accounts-verify"></ul>
        <div class="row">
          <button type="button" class="small primary" data-s="approved">開放查證</button>
          <button type="button" class="small" data-s="rejected">不通過</button>
          <button type="button" class="small" data-s="pending">改回待審核</button>
        </div>
      </div>`;
    const accs = li.querySelector('.accounts-verify');
    for (const a of k.accounts) {
      const row = document.createElement('li');
      row.innerHTML = `<div>${accountLink(a)}</div><small>驗證碼 <code>${esc(a.code)}</code></small>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'small';
      btn.textContent = a.verified ? '取消驗證' : '人工確認是本人的帳號';
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/admin/accounts/${a.id}`, { method: 'POST', token: token(), body: { verified: !a.verified } });
          load();
        } catch (err) {
          setLine('admin-result', err.message, 'bad');
        }
      });
      row.appendChild(btn);
      accs.appendChild(row);
    }
    for (const btn of li.querySelectorAll('[data-s]')) {
      if (btn.dataset.s === k.status) btn.disabled = true;
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/admin/kols/${k.id}`, { method: 'POST', token: token(), body: { status: btn.dataset.s } });
          load();
        } catch (err) {
          setLine('admin-result', err.message, 'bad');
        }
      });
    }
    list.appendChild(li);
  }
}

try {
  $('admin-token').value = sessionStorage.getItem('tb-admin') || '';
} catch (_) {
  /* 無法使用儲存空間 */
}
$('load').addEventListener('click', load);
$('filter').addEventListener('change', load);
