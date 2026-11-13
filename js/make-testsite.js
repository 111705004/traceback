// 用成員的照片做出測試站要用的三則模擬廣告圖。
// 改法和示範搜尋用的一樣（js/search.js 的 MOCK_EDITS），圖上都有「示範用模擬內容」標記。
import * as M from './matching.js';
import { MOCK_EDITS } from './search.js';

const $ = (id) => document.getElementById(id);

// 測試站每一頁對應的檔名與改法
const TARGETS = [
  { file: 'ad-teacher.jpg', page: '財經老師親授：飆股名單免費領', edit: 'banner' },
  { file: 'ad-line.jpg', page: '三個月翻倍', edit: 'mirror' },
  { file: 'ad-health.jpg', page: '名人推薦保健食品', edit: 'composite' },
];

let photos = [];
let made = [];

function refresh() {
  $('count').textContent = photos.length ? `已選 ${photos.length} 張` : '還沒有照片';
  $('make').disabled = !(photos.length && $('consent').checked);
}

function addFiles(list) {
  photos = [...list].filter((f) => f.type.startsWith('image/')).slice(0, 3);
  refresh();
}

async function make() {
  const line = $('make-result');
  $('make').disabled = true;
  line.className = 'result-line';
  line.textContent = '正在找照片裡的臉。第一次需要下載模型，請等一下';
  try {
    const canvases = [];
    for (const f of photos) {
      const canvas = M.toCanvas(await M.fileToImage(f), 900);
      const faces = await M.faceDescriptors(canvas);
      if (!faces.length) {
        line.className = 'result-line bad';
        line.textContent = `${f.name} 裡找不到臉，請換一張臉清楚的照片。`;
        return;
      }
      canvases.push(canvas);
    }
    made = [];
    for (let i = 0; i < TARGETS.length; i++) {
      const t = TARGETS[i];
      const src = canvases[i % canvases.length];
      const edit = MOCK_EDITS.find((e) => e.key === t.edit);
      const box = M.faceBoxes(src)[0] || null;
      const canvas = edit.make(src, box);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
      made.push({ ...t, canvas, blob });
    }
    $('previews').innerHTML = '';
    for (const m of made) {
      const li = document.createElement('li');
      li.appendChild(M.toCanvas(m.canvas, 320));
      li.insertAdjacentHTML('beforeend', `<strong>${m.file}</strong><small>測試站「${m.page}」那一頁</small>`);
      $('previews').appendChild(li);
    }
    $('out').hidden = false;
    line.className = 'result-line ok';
    line.textContent = '做好了，往下載。';
  } catch (err) {
    console.error(err);
    line.className = 'result-line bad';
    line.textContent = '製作失敗，請重新整理頁面再試一次。';
  } finally {
    refresh();
  }
}

function download() {
  made.forEach((m, i) => {
    // 瀏覽器會擋住同時觸發的多個下載，間隔一下
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(m.blob);
      a.download = m.file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, i * 400);
  });
}

$('files').addEventListener('change', (e) => addFiles(e.target.files));
$('drop').addEventListener('dragover', (e) => e.preventDefault());
$('drop').addEventListener('drop', (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});
$('consent').addEventListener('change', refresh);
$('make').addEventListener('click', make);
$('download').addEventListener('click', download);
refresh();
