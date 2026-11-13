// 輔助訊號：這張圖「疑似 AI 生成」的分數。
// 這是沒有原圖可對照時的盲測，輸出的是模型的信心，不是事實；只能當參考，不能單獨下結論。
// 模型：Community Forensics（CVPR 2025），ViT-Small，以數千種生成器的圖片訓練，MIT 授權。

import { CDN } from './matching.js';

export const AI_MODEL = {
  id: 'buildborderless/CommunityForensics-DeepfakeDet-ViT',
  // 量化版在瀏覽器的 WASM 執行環境缺少 ConvInteger 運算，載入會失敗，
  // 而且失敗後同一頁的其他模型也會跟著載入失敗，所以固定用未量化的版本（約 87 MB）。
  dtype: 'fp32',
};

// 暫定值，要用比對實驗的結果校正。
export const AI_THRESHOLDS = { high: 0.8, mid: 0.5 };

let detectorPromise = null;

export function loadDetector(onProgress) {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const tf = await import(/* @vite-ignore */ CDN.transformers);
      const model = await tf.AutoModelForImageClassification.from_pretrained(AI_MODEL.id, {
        dtype: AI_MODEL.dtype,
        progress_callback: onProgress,
      });
      const processor = await tf.AutoProcessor.from_pretrained(AI_MODEL.id);
      return { model, processor, RawImage: tf.RawImage };
    })().catch((err) => {
      detectorPromise = null;
      throw err;
    });
  }
  return detectorPromise;
}

// 回傳 0 到 1 的分數，越高越像 AI 生成。
// 前處理由模型自帶的設定決定：短邊縮到 440、中央裁切 384。所以只看得到畫面中央。
export async function aiScore(canvas) {
  const { model, processor, RawImage } = await loadDetector();
  const inputs = await processor(RawImage.fromCanvas(canvas));
  const { logits } = await model(inputs);
  return 1 / (1 + Math.exp(-logits.data[0]));
}

export function aiLevel(score) {
  if (score === null || score === undefined) return 'na';
  return score >= AI_THRESHOLDS.high ? 'high' : score >= AI_THRESHOLDS.mid ? 'mid' : 'low';
}
