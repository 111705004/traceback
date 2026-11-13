// 四層比對：感知雜湊、影像特徵向量、局部特徵點加幾何驗證、人臉相似度。
// 所有運算都在瀏覽器內完成；只有模型檔與函式庫從公開 CDN 下載。

export const CDN = {
  transformers: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5',
  embedModel: 'Xenova/dinov2-small',
  faceApi: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js',
  faceModels: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model',
  opencv: 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js',
};

// 門檻都是暫定值，要用比對實驗的結果校正。
export const THRESHOLDS = {
  hashNear: 10, // 漢明距離，64 位元中相異的位元數
  hashClose: 18,
  embedHigh: 0.8, // 餘弦相似度
  embedMid: 0.6,
  inliersHigh: 25, // 通過幾何驗證的特徵點對數
  inliersMid: 15,
  inlierRatioHigh: 0.5, // 通過幾何驗證的比例
  inlierRatioMid: 0.35,
  faceSame: 0.5, // 人臉特徵的歐氏距離，越小越像
  faceId: 0.55, // 證件照通常較舊、較小，放寬一些
  diffPixel: 40, // 灰階差異超過此值視為被改動
  // 以下用來判斷改動類型，比例都是 0 到 1
  editOverlay: 0.015, // 臉以外的改動低於此值視為沒有改動
  editHeavy: 0.45, // 臉以外的改動超過此值視為背景或身體被換掉
  editBorder: 0.6, // 照片外圍一圈被改動的比例超過此值，也視為背景被換掉
  editFaceChanged: 0.35, // 臉部區域的改動超過此值視為臉被修改
  editCropUsed: 0.85, // 你的照片出現在可疑圖裡的比例低於此值視為被裁切
  editEmbedCover: 0.75, // 你的照片占可疑圖的比例低於此值視為被放進別的版面
};

// ---------- 影像工具 ----------

// 用 createImageBitmap 解碼。用 <img> 的 decode() 在背景分頁會被瀏覽器無限期延後，
// 批次實驗跑到一半切換分頁就會卡住。
export function fileToImage(file) {
  return createImageBitmap(file);
}

export function toCanvas(source, maxSide = 640) {
  const w = source.naturalWidth || source.videoWidth || source.width;
  const h = source.naturalHeight || source.videoHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ---------- 第 1 層：感知雜湊 ----------

function dct1d(v) {
  const n = v.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += v[i] * Math.cos((Math.PI * (i + 0.5) * k) / n);
    out[k] = sum;
  }
  return out;
}

export function pHash(source) {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = new Float64Array(size);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      row[x] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    rows.push(dct1d(row));
  }
  const low = [];
  for (let x = 0; x < 8; x++) {
    const col = new Float64Array(size);
    for (let y = 0; y < size; y++) col[y] = rows[y][x];
    const d = dct1d(col);
    for (let y = 0; y < 8; y++) low[y * 8 + x] = d[y];
  }
  const sorted = low.slice(1).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return low.map((v) => (v > median ? 1 : 0));
}

export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export function hashToHex(bits) {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  }
  return hex;
}

// ---------- 第 2 層：影像特徵向量 ----------

let extractorPromise = null;

export function loadEmbedder(onProgress) {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const tf = await import(/* @vite-ignore */ CDN.transformers);
      const extractor = await tf.pipeline('image-feature-extraction', CDN.embedModel, {
        progress_callback: onProgress,
      });
      return { extractor, RawImage: tf.RawImage };
    })().catch((err) => {
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

export async function embed(canvas) {
  const { extractor, RawImage } = await loadEmbedder();
  // 模型本來就會把圖縮到 224 像素，先縮小可以省下編碼與解碼的時間
  const small = toCanvas(canvas, 256);
  const image = await RawImage.fromURL(small.toDataURL('image/jpeg', 0.92));
  const out = await extractor(image);
  const dim = out.dims[out.dims.length - 1];
  // 輸出是 [1, tokens, dim]，第一個 token 代表整張圖
  const vec = Float32Array.from(out.data.slice(0, dim));
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ---------- 第 3 層：局部特徵點比對加幾何驗證 ----------

let cvPromise = null;
let cvModule = null;

// OpenCV 的模組物件本身帶有 then 方法，直接 await 或拿它去 resolve 會無限循環。
// 所以模組存在變數裡，Promise 只回傳 true。
export function loadOpenCV() {
  if (!cvPromise) {
    cvPromise = new Promise((resolve, reject) => {
      const ready = (mod) => {
        try {
          delete mod.then;
        } catch (_) {
          /* 不是自有屬性 */
        }
        cvModule = mod;
        resolve(true);
      };
      const script = document.createElement('script');
      script.src = CDN.opencv;
      script.async = true;
      script.onerror = () => reject(new Error('OpenCV 載入失敗'));
      script.onload = () => {
        const cv = window.cv;
        if (!cv) return reject(new Error('OpenCV 載入後找不到 cv'));
        if (cv.Mat) return ready(cv);
        if (typeof cv.then === 'function') return cv.then(ready);
        cv.onRuntimeInitialized = () => ready(cv);
      };
      document.head.appendChild(script);
    }).catch((err) => {
      cvPromise = null;
      throw err;
    });
  }
  return cvPromise;
}

// 估計兩張已對齊的灰階圖之間的整體亮度倍率：取逐像素比值的中位數。
// 被改動的區域只要不超過一半，中位數就落在沒被改動的像素上。
function medianGain(target, source, mask) {
  const hist = new Uint32Array(401); // 比值 0.00 到 4.00，間隔 0.01
  const t = target.data;
  const s = source.data;
  const m = mask.data;
  let count = 0;
  for (let i = 0; i < t.length; i++) {
    if (m[i] && s[i] >= 16) {
      hist[Math.min(400, Math.round((t[i] / s[i]) * 100))]++;
      count++;
    }
  }
  if (count === 0) return 1;
  let seen = 0;
  for (let v = 0; v <= 400; v++) {
    seen += hist[v];
    if (seen * 2 >= count) return Math.min(1.6, Math.max(0.6, v / 100));
  }
  return 1;
}

// 每張圖的特徵點只算一次。批次實驗要比對上千組，重算會很慢。
const featureCache = new Map();

function localFeatures(cv, canvas) {
  let f = featureCache.get(canvas);
  if (f) return f;
  const img = cv.imread(canvas);
  const gray = new cv.Mat();
  cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);
  const orb = new cv.ORB(2000);
  const kp = new cv.KeyPointVector();
  const des = new cv.Mat();
  const none = new cv.Mat();
  orb.detectAndCompute(gray, none, kp, des);
  const pts = new Float32Array(kp.size() * 2);
  for (let i = 0; i < kp.size(); i++) {
    const p = kp.get(i).pt;
    pts[i * 2] = p.x;
    pts[i * 2 + 1] = p.y;
  }
  for (const m of [img, gray, orb, kp, none]) m.delete();
  f = { des, pts };
  featureCache.set(canvas, f);
  return f;
}

// 釋放單一畫布的特徵點。搜尋時看過就丟的圖用這個。
export function forgetFeatures(canvas) {
  const f = featureCache.get(canvas);
  if (f) {
    f.des.delete();
    featureCache.delete(canvas);
  }
}

export function flipCanvas(source) {
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.translate(c.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0);
  return c;
}

// 釋放快取的特徵點。OpenCV 的記憶體不會自動回收。
export function clearFeatureCache() {
  for (const f of featureCache.values()) f.des.delete();
  featureCache.clear();
}

// 回傳：配對數、通過幾何驗證的配對數、被改動的面積比例，以及標出改動區域的畫布。
// refFaceBox 是參考照上本人臉部的方框；有提供時，會另外量出臉部與臉以外各被改動多少。
export async function localMatch(refCanvas, susCanvas, refFaceBox = null) {
  await loadOpenCV();
  const cv = cvModule;
  const trash = [];
  const keep = (m) => {
    trash.push(m);
    return m;
  };
  const result = {
    good: 0,
    inliers: 0,
    changedRatio: null,
    overlay: null,
    coverage: null, // 參考照占可疑圖面積的比例
    refUsed: null, // 參考照有多少比例出現在可疑圖裡
    faceRegion: null, // 參考照的臉對應到可疑圖上的位置
    changedInFace: null,
    changedOutsideFace: null,
    changedOnBorder: null, // 照片外圍一圈有多少比例被改動
  };
  try {
    const f1 = localFeatures(cv, refCanvas);
    const f2 = localFeatures(cv, susCanvas);
    if (f1.des.rows < 8 || f2.des.rows < 8) return result;

    const matcher = keep(new cv.BFMatcher(cv.NORM_HAMMING, false));
    const knn = keep(new cv.DMatchVectorVector());
    matcher.knnMatch(f1.des, f2.des, knn, 2);
    const src = [];
    const dst = [];
    for (let i = 0; i < knn.size(); i++) {
      const pair = knn.get(i);
      if (pair.size() >= 2) {
        const m = pair.get(0);
        const n = pair.get(1);
        if (m.distance < 0.75 * n.distance) {
          src.push(f1.pts[m.queryIdx * 2], f1.pts[m.queryIdx * 2 + 1]);
          dst.push(f2.pts[m.trainIdx * 2], f2.pts[m.trainIdx * 2 + 1]);
        }
      }
      pair.delete();
    }
    result.good = src.length / 2;
    if (result.good < 8) return result;

    const srcMat = keep(cv.matFromArray(result.good, 1, cv.CV_32FC2, src));
    const dstMat = keep(cv.matFromArray(result.good, 1, cv.CV_32FC2, dst));
    const inlierMask = keep(new cv.Mat());
    const H = keep(cv.findHomography(srcMat, dstMat, cv.RANSAC, 4.0, inlierMask));
    if (H.empty()) return result;
    result.inliers = cv.countNonZero(inlierMask);
    if (result.inliers < THRESHOLDS.inliersMid || result.inliers / result.good < THRESHOLDS.inlierRatioMid) {
      return result;
    }

    // 把參考照對齊到可疑圖的座標，再逐區比較差異
    const ref = keep(cv.imread(refCanvas));
    const sus = keep(cv.imread(susCanvas));
    const refGray = keep(new cv.Mat());
    const susGray = keep(new cv.Mat());
    cv.cvtColor(ref, refGray, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(sus, susGray, cv.COLOR_RGBA2GRAY);
    const size = new cv.Size(sus.cols, sus.rows);
    const warped = keep(new cv.Mat());
    cv.warpPerspective(refGray, warped, H, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
    const white = keep(new cv.Mat(ref.rows, ref.cols, cv.CV_8UC1, new cv.Scalar(255)));
    const valid = keep(new cv.Mat());
    cv.warpPerspective(white, valid, H, size, cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar());
    const edge = keep(cv.Mat.ones(9, 9, cv.CV_8U));
    cv.erode(valid, valid, edge);
    const validArea = cv.countNonZero(valid);
    if (validArea === 0) return result;

    // 先把整體亮度拉齊，避免濾鏡造成整張都被標記。
    // 用逐像素比值的中位數而不是平均：被貼上的橫幅或色塊會把平均值拉偏。
    cv.convertScaleAbs(warped, warped, medianGain(susGray, warped, valid), 0);

    const blurA = keep(new cv.Mat());
    const blurB = keep(new cv.Mat());
    const ksize = new cv.Size(9, 9);
    cv.GaussianBlur(warped, blurA, ksize, 0);
    cv.GaussianBlur(susGray, blurB, ksize, 0);
    const diff = keep(new cv.Mat());
    cv.absdiff(blurA, blurB, diff);
    const mask = keep(new cv.Mat());
    cv.threshold(diff, mask, THRESHOLDS.diffPixel, 255, cv.THRESH_BINARY);
    cv.bitwise_and(mask, valid, mask);
    const small = keep(cv.Mat.ones(5, 5, cv.CV_8U));
    const big = keep(cv.Mat.ones(15, 15, cv.CV_8U));
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, small);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, big);
    cv.bitwise_and(mask, valid, mask);
    const changedArea = cv.countNonZero(mask);
    result.changedRatio = changedArea / validArea;
    result.coverage = validArea / (sus.cols * sus.rows);

    // 外圍一圈的改動比例。換背景會把整圈都改掉；加橫幅或貼圖只會動到其中一段。
    const band = Math.max(5, Math.round(Math.min(sus.cols, sus.rows) * 0.1) | 1);
    const bandKernel = keep(cv.Mat.ones(band, band, cv.CV_8U));
    const inner = keep(new cv.Mat());
    // 邊界外當成空白，照片占滿整張圖時才量得到外圍
    cv.erode(valid, inner, bandKernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, new cv.Scalar(0));
    const ring = keep(new cv.Mat());
    cv.subtract(valid, inner, ring);
    const ringArea = cv.countNonZero(ring);
    if (ringArea > 0) {
      const ringChanged = keep(new cv.Mat());
      cv.bitwise_and(mask, ring, ringChanged);
      result.changedOnBorder = cv.countNonZero(ringChanged) / ringArea;
    }

    // 反向對齊一張全白的圖，看參考照有多少面積落在可疑圖的範圍內
    const whiteSus = keep(new cv.Mat(sus.rows, sus.cols, cv.CV_8UC1, new cv.Scalar(255)));
    const back = keep(new cv.Mat());
    cv.warpPerspective(
      whiteSus,
      back,
      H,
      new cv.Size(ref.cols, ref.rows),
      cv.INTER_NEAREST | (cv.WARP_INVERSE_MAP ?? 16),
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    );
    result.refUsed = cv.countNonZero(back) / (ref.cols * ref.rows);

    // 把參考照上的臉部方框搬到可疑圖的座標，分別統計臉部與臉以外的改動
    if (refFaceBox) {
      const h = H.data64F;
      // 偵測到的臉部方框只到額頭與下巴，往外放寬兩成，把髮際與臉頰邊緣算進來
      const grow = 0.2;
      const b = {
        x: refFaceBox.x - refFaceBox.width * grow,
        y: refFaceBox.y - refFaceBox.height * grow,
        width: refFaceBox.width * (1 + 2 * grow),
        height: refFaceBox.height * (1 + 2 * grow),
      };
      const xs = [];
      const ys = [];
      for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]]) {
        const w = h[6] * x + h[7] * y + h[8] || 1;
        xs.push((h[0] * x + h[1] * y + h[2]) / w);
        ys.push((h[3] * x + h[4] * y + h[5]) / w);
      }
      const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
      const x0 = clamp(Math.min(...xs), sus.cols);
      const x1 = clamp(Math.max(...xs), sus.cols);
      const y0 = clamp(Math.min(...ys), sus.rows);
      const y1 = clamp(Math.max(...ys), sus.rows);
      if (x1 - x0 >= 8 && y1 - y0 >= 8) {
        const rect = new cv.Rect(x0, y0, x1 - x0, y1 - y0);
        const maskRoi = mask.roi(rect);
        const validRoi = valid.roi(rect);
        const changedIn = cv.countNonZero(maskRoi);
        const validIn = cv.countNonZero(validRoi);
        maskRoi.delete();
        validRoi.delete();
        if (validIn > 0) {
          result.faceRegion = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
          result.changedInFace = changedIn / validIn;
          const validOut = validArea - validIn;
          result.changedOutsideFace = validOut > 0 ? (changedArea - changedIn) / validOut : null;
        }
      }
    }

    // 產生標示畫布：紅色是被改動的區域，變暗的是參考照沒有涵蓋的區域
    const overlay = document.createElement('canvas');
    overlay.width = sus.cols;
    overlay.height = sus.rows;
    const ctx = overlay.getContext('2d');
    ctx.drawImage(susCanvas, 0, 0);
    const frame = ctx.getImageData(0, 0, overlay.width, overlay.height);
    const m = mask.data;
    const v = valid.data;
    for (let i = 0; i < m.length; i++) {
      const p = i * 4;
      if (m[i]) {
        frame.data[p] = Math.round(frame.data[p] * 0.35 + 255 * 0.65);
        frame.data[p + 1] = Math.round(frame.data[p + 1] * 0.35);
        frame.data[p + 2] = Math.round(frame.data[p + 2] * 0.35);
      } else if (!v[i]) {
        frame.data[p] = Math.round(frame.data[p] * 0.45);
        frame.data[p + 1] = Math.round(frame.data[p + 1] * 0.45);
        frame.data[p + 2] = Math.round(frame.data[p + 2] * 0.45);
      }
    }
    ctx.putImageData(frame, 0, 0);
    result.overlay = overlay;
    return result;
  } finally {
    for (const m of trash) {
      try {
        m.delete();
      } catch (_) {
        /* 已釋放 */
      }
    }
  }
}

// ---------- 第 4 層：人臉相似度 ----------

let facePromise = null;

export function loadFace() {
  if (!facePromise) {
    facePromise = (async () => {
      const faceapi = await import(/* @vite-ignore */ CDN.faceApi);
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(CDN.faceModels),
        faceapi.nets.faceLandmark68Net.loadFromUri(CDN.faceModels),
        faceapi.nets.faceRecognitionNet.loadFromUri(CDN.faceModels),
      ]);
      return faceapi;
    })().catch((err) => {
      facePromise = null;
      throw err;
    });
  }
  return facePromise;
}

// 每張畫布偵測到的臉部方框，順序與 faceDescriptors 回傳的特徵向量相同。
const faceBoxCache = new WeakMap();

// 回傳畫面中每張臉的特徵向量，由大到小排列。
export async function faceDescriptors(canvas) {
  const faceapi = await loadFace();
  const found = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  found.sort((a, b) => b.detection.box.area - a.detection.box.area);
  faceBoxCache.set(
    canvas,
    found.map((f) => {
      const b = f.detection.box;
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }),
  );
  return found.map((f) => f.descriptor);
}

export function faceBoxes(canvas) {
  return faceBoxCache.get(canvas) || [];
}

export function faceDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// 一組臉對另一組臉的最小距離；任一方沒有臉則回傳 null。
export function closestFace(listA, listB) {
  if (!listA.length || !listB.length) return null;
  let best = Infinity;
  for (const a of listA) for (const b of listB) best = Math.min(best, faceDistance(a, b));
  return best;
}

// ---------- 改動類型 ----------

// 依對齊後量到的數值，判斷可疑圖相對於參考照被做了哪些事。
// 回傳的 tags 可能同時有好幾個，例如「裁切、左右翻轉、加上文字」。
// 這是依規則推斷，不是模型判定；門檻是暫定值。
function analyzeEdit(verdict, layers, local, mirrored, faceThere) {
  const T = THRESHOLDS;
  const edit = {
    basis: 'none', // aligned：對齊後量出來的；hash：幾乎相同的圖；face-only：只有臉像；none：無法判斷
    tags: [],
    mirrored,
    coverage: local.coverage,
    refUsed: local.refUsed,
    changedRatio: local.changedRatio,
    changedInFace: local.changedInFace,
    changedOutsideFace: local.changedOutsideFace,
    changedOnBorder: local.changedOnBorder,
    faceThereDist: faceThere,
  };
  if (verdict !== 'derived' && verdict !== 'likely') {
    if (verdict === 'face-only') {
      edit.basis = 'face-only';
      edit.tags.push('face-only');
    }
    return edit;
  }
  if (local.changedRatio === null) {
    // 沒有對齊結果卻判定相符，只會是雜湊幾乎相同
    if (layers.hash === 'high') {
      edit.basis = 'hash';
      edit.tags.push('identical');
    }
    return edit;
  }

  edit.basis = 'aligned';
  if (mirrored) edit.tags.push('mirrored');
  if (local.refUsed !== null && local.refUsed < T.editCropUsed) edit.tags.push('cropped');
  if (local.coverage !== null && local.coverage < T.editEmbedCover) edit.tags.push('embedded');

  if (local.changedInFace !== null) {
    if (local.changedInFace >= T.editFaceChanged) {
      // 臉的位置被改了：那裡偵測不到臉算被遮住，認得出是本人算修改，是另一張臉算被換掉
      if (faceThere === null) edit.tags.push('face-hidden');
      else edit.tags.push(faceThere <= T.faceSame ? 'face-retouched' : 'face-replaced');
    } else {
      edit.tags.push('face-intact');
    }
  }
  const outside = local.changedOutsideFace ?? local.changedRatio;
  if (outside >= T.editHeavy || (local.changedOnBorder ?? 0) >= T.editBorder) edit.tags.push('background');
  else if (outside >= T.editOverlay) edit.tags.push('overlay');

  if (edit.tags.every((t) => t === 'face-intact')) edit.tags.push('identical');
  return edit;
}

// ---------- 綜合 ----------

// 為一張圖算出比對所需的特徵。
export async function describe(canvas, { withEmbedding = true, withFaces = true } = {}) {
  const features = { canvas, hash: pHash(canvas), embedding: null, faces: [] };
  if (withEmbedding) features.embedding = await embed(canvas);
  if (withFaces) features.faces = await faceDescriptors(canvas);
  return features;
}

// 比較一張參考照與一張可疑圖，回傳四層分數與綜合判斷。
export async function comparePair(ref, sus) {
  const hashDistance = hamming(ref.hash, sus.hash);
  const embedSim = ref.embedding && sus.embedding ? cosine(ref.embedding, sus.embedding) : null;
  // 參考照上哪一張臉是本人：呼叫端有指定就用指定的，否則用最大的那張
  const refFaceIndex = ref.faceIndex ?? 0;
  const refFaceBox = faceBoxes(ref.canvas)[refFaceIndex] || null;
  let local = await localMatch(ref.canvas, sus.canvas, refFaceBox);
  const faceDist = closestFace(ref.faces, sus.faces);

  const T = THRESHOLDS;
  // 左右翻轉會讓雜湊與特徵點都對不上。其他層顯示可能相關時，把可疑圖翻回來再試一次。
  let mirrored = false;
  const related = (embedSim !== null && embedSim >= T.embedMid) || (faceDist !== null && faceDist <= T.faceSame);
  if (local.inliers < T.inliersMid && related) {
    const flipped = flipCanvas(sus.canvas);
    const alt = await localMatch(ref.canvas, flipped, refFaceBox);
    forgetFeatures(flipped);
    if (alt.inliers > local.inliers && alt.inliers >= T.inliersMid) {
      if (alt.overlay) alt.overlay = flipCanvas(alt.overlay);
      // 臉部位置是在翻轉後的座標量的，換回原本的座標
      if (alt.faceRegion) alt.faceRegion.x = sus.canvas.width - alt.faceRegion.x - alt.faceRegion.width;
      local = alt;
      mirrored = true;
    }
  }
  // 幾何驗證同時看數量與比例：不相干的圖偶爾也會湊出十幾組配對，但比例很低
  const ratio = local.good ? local.inliers / local.good : 0;
  const layers = {
    hash: hashDistance <= T.hashNear ? 'high' : hashDistance <= T.hashClose ? 'mid' : 'low',
    embed: embedSim === null ? 'na' : embedSim >= T.embedHigh ? 'high' : embedSim >= T.embedMid ? 'mid' : 'low',
    local:
      local.inliers >= T.inliersHigh && ratio >= T.inlierRatioHigh
        ? 'high'
        : local.inliers >= T.inliersMid && ratio >= T.inlierRatioMid
          ? 'mid'
          : 'low',
    face: faceDist === null ? 'na' : faceDist <= T.faceSame ? 'high' : 'low',
  };

  // derived：可確認源自這張照片；likely：很可能；similar：只有整體構圖像；face-only：只有臉像
  let verdict = 'none';
  if (layers.hash === 'high' || layers.local === 'high') verdict = 'derived';
  else if (layers.local === 'mid' || (layers.embed === 'high' && (layers.hash === 'mid' || layers.face === 'high')))
    verdict = 'likely';
  else if (layers.face === 'high') verdict = 'face-only';
  else if (layers.embed === 'high') verdict = 'similar';

  // 排序用：幾何驗證最可靠，其次是特徵向量與雜湊
  const rank = local.inliers * 10 + (embedSim || 0) * 100 + (64 - hashDistance);
  // 參考照的臉對應到可疑圖的位置上，現在是誰的臉
  let faceThere = null;
  const refFace = ref.faces[refFaceIndex];
  if (local.faceRegion && refFace) {
    const r = local.faceRegion;
    faceBoxes(sus.canvas).forEach((b, i) => {
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      if (cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height && sus.faces[i]) {
        const d = faceDistance(refFace, sus.faces[i]);
        if (faceThere === null || d < faceThere) faceThere = d;
      }
    });
  }
  const edit = analyzeEdit(verdict, layers, local, mirrored, faceThere);

  return { hashDistance, embedSim, local, faceDist, layers, verdict, rank, mirrored, edit };
}
