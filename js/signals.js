// 「其他線索」：檔案來源標記、換臉跡象、疑似 AI 生成分數。
// 民眾查證頁與路徑一的比對結果頁共用。這些都是輔助訊號，不單獨下結論。
import { describeProvenance } from './provenance.js';
import { aiScore, aiLevel, loadDetector } from './aidetect.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function item(level, title, text) {
  // level：high 值得注意、mid 參考、low 沒發現
  return `<li class="${level === 'low' ? 'calm' : ''}"><strong>${esc(title)}</strong>${esc(text)}</li>`;
}

// provenance：readProvenance 的結果；swap：{ found, inner, outer, basis } 或 null
export function renderSignals(list, { provenance, swap }) {
  const rows = [];
  if (provenance) {
    const p = describeProvenance(provenance);
    rows.push(item(p.level, p.title, p.text));
  }
  if (swap) {
    const nums = Number.isFinite(swap.inner) ? `（五官距離 ${swap.inner.toFixed(2)}、臉型距離 ${swap.outer.toFixed(2)}，門檻是暫定值）` : '';
    rows.push(
      swap.found
        ? item('high', '可能經過換臉', `五官很像${swap.who}，但臉型、下巴或髮際線不像，可能是把${swap.who}的臉換到別人身上${nums}。`)
        : item('low', '沒有看到換臉跡象', `五官與臉型都和${swap.who}一致，或資料不足以判斷${nums}。換臉做得好時也可能看不出來。`),
    );
  }
  list.innerHTML = rows.join('');
}

// 按鈕：下載偵測模型後算「疑似 AI 生成」分數
export function setupAiButton(button, line, getCanvas) {
  button.addEventListener('click', async () => {
    const canvas = getCanvas();
    if (!canvas) return;
    button.disabled = true;
    line.className = 'result-line';
    line.textContent = '正在下載偵測模型（約 87 MB，第一次需要等一下）';
    try {
      await loadDetector((p) => {
        if (p.status === 'progress' && p.total) line.textContent = `正在下載偵測模型：${Math.round((p.loaded / p.total) * 100)}%`;
      });
      line.textContent = '正在計算';
      const score = await aiScore(canvas);
      const level = aiLevel(score);
      const pct = Math.round(score * 100);
      if (level === 'high') {
        line.className = 'result-line bad';
        line.textContent = `偵測模型認為很可能是 AI 生成（分數 ${pct}/100）。這類模型很少把真照片誤判成 AI，但仍只是參考。`;
      } else if (level === 'mid') {
        line.className = 'result-line';
        line.textContent = `偵測模型認為有點像 AI 生成（分數 ${pct}/100），無法確定。`;
      } else {
        line.className = 'result-line';
        line.textContent = `偵測模型沒有發現 AI 生成的跡象（分數 ${pct}/100）。這不代表是真的：廣告常見的縮圖、壓縮、加字會讓這類模型漏掉大部分 AI 圖。`;
      }
    } catch (err) {
      console.error(err);
      line.className = 'result-line bad';
      line.textContent = '偵測模型載入失敗，請稍後再試。';
      button.disabled = false;
    }
  });
}
