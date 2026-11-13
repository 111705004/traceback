// 換臉檢查：分別比對「內臉」（眉毛到嘴巴的五官）與「外臉」（臉型、下巴、額頭、髮際線）。
//
// 換臉工具通常只替換五官區域，頭型、髮際線、耳朵還是原本那個人的。
// 所以「五官像 A、臉型像 B」就是換臉的跡象。真的照片兩者會一致。
//
// 做法：用 face-api 找出 68 個臉部特徵點，把眉毛到嘴巴圍成一個區域。
// 內臉：只留這個區域，其他塗成灰色；外臉：把這個區域塗成灰色。
// 兩張圖各算一次臉部特徵，再和參考照同樣處理後的特徵比較。
// 只能和同樣處理過的特徵比，不能和完整臉的特徵混著比。
//
// 門檻是用 face-api 範例照片粗估的暫定值，要用真正的換臉圖校正。

import { loadFace } from './matching.js';

// 2026/11/13 用 face-api 範例照片粗估（不是正式實驗）：
// 不同人的內臉距離最小 0.43、中位數 0.65；同一張照片經縮放、壓縮、旋轉後最大 0.40。
// 外臉的鑑別力弱很多：不同人的中位數只有 0.32，同一人最大 0.24。
// 用剪貼做的 11 組粗糙換臉，在下面的門檻只抓到少數幾組；真正的換臉工具效果未知。
export const PART_THRESHOLDS = {
  innerIdentify: 0.4, // 只靠五官認人時的門檻，要比不同人的最小值還低
  innerClose: 0.45, // 完整的臉已經對上時，五官要多像才算本人的五官
  outerDiffer: 0.28, // 外臉距離超過此值視為臉型不像
};

const SIZE = 150; // face-api 臉部特徵模型的輸入大小

function hull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function polygon(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

// 回傳畫面中每張臉的內臉與外臉特徵，順序與 matching.js 的 faceDescriptors 相同（由大到小）。
export async function faceParts(canvas) {
  const faceapi = await loadFace();
  const found = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
    .withFaceLandmarks();
  found.sort((a, b) => b.detection.box.area - a.detection.box.area);
  const out = [];
  for (const f of found) {
    const box = f.alignedRect.box;
    const sx = SIZE / box.width;
    const sy = SIZE / box.height;
    const crop = document.createElement('canvas');
    crop.width = SIZE;
    crop.height = SIZE;
    crop.getContext('2d').drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, SIZE, SIZE);

    // 特徵點 17 到 67：眉毛、鼻子、眼睛、嘴巴。往外擴一點，蓋住五官邊緣
    const pts = f.landmarks.positions.slice(17).map((p) => ({ x: (p.x - box.x) * sx, y: (p.y - box.y) * sy }));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const region = hull(pts).map((p) => ({ x: cx + (p.x - cx) * 1.1, y: cy + (p.y - cy) * 1.1 }));

    const inner = document.createElement('canvas');
    inner.width = SIZE;
    inner.height = SIZE;
    const ic = inner.getContext('2d');
    ic.fillStyle = '#808080';
    ic.fillRect(0, 0, SIZE, SIZE);
    ic.save();
    polygon(ic, region);
    ic.clip();
    ic.drawImage(crop, 0, 0);
    ic.restore();

    const outer = document.createElement('canvas');
    outer.width = SIZE;
    outer.height = SIZE;
    const oc = outer.getContext('2d');
    oc.drawImage(crop, 0, 0);
    oc.fillStyle = '#808080';
    polygon(oc, region);
    oc.fill();

    out.push({
      inner: Array.from(await faceapi.computeFaceDescriptor(inner)),
      outer: Array.from(await faceapi.computeFaceDescriptor(outer)),
    });
  }
  return out;
}

function dist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// 可疑圖上每張臉，和一組參考臉比：回傳內臉、外臉各自的最小距離
export function partDistances(sus, refs) {
  return sus.map((s) => ({
    inner: Math.min(...refs.map((r) => dist(s.inner, r.inner))),
    outer: Math.min(...refs.map((r) => dist(s.outer, r.outer))),
  }));
}

// 五官像本人、臉型不像：可能是本人的臉被換到別人身上，這是冒用常見的做法。
// identified 表示完整的臉已經對上本人，此時五官門檻可以放寬一點。
// 反過來（臉型像、五官不像）外臉太容易誤判，不在這裡判斷；有原圖時改由對齊比對判斷。
export function swapSignal(d, identified) {
  const T = PART_THRESHOLDS;
  if (!d) return false;
  return d.inner <= (identified ? T.innerClose : T.innerIdentify) && d.outer >= T.outerDiffer;
}
