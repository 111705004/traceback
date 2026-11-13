// 把比對量到的改動類型（matching.js 的 edit.tags）轉成一般人看得懂的話。

export const EDIT_LABELS = {
  identical: '原圖直接使用',
  mirrored: '左右翻轉',
  cropped: '裁切',
  embedded: '放進別的版面',
  overlay: '加上文字或貼圖',
  background: '背景或身體被換掉',
  'face-intact': '臉沒有被改',
  'face-retouched': '臉部被修改',
  'face-replaced': '臉被換成另一張臉',
  'face-hidden': '臉被遮住或改到認不出來',
  'face-only': '只有臉像你',
};

const pct = (v) => `${Math.round(v * 100)}%`;

// 標題挑最嚴重的一項來講
const HEADLINES = [
  ['face-replaced', '你的照片被拿去用，而且臉被換成了另一張臉'],
  ['face-hidden', '你的照片被拿去用，臉的位置被遮住或改到認不出來'],
  ['background', '臉和姿勢來自你的照片，背景或身體被大幅改掉'],
  ['face-retouched', '你的照片被拿去用，臉部被修改過'],
  ['overlay', '你的照片被加上了文字、貼圖或其他內容'],
  ['embedded', '你的照片被放進別的版面'],
  ['cropped', '你的照片被裁切後拿去用'],
  ['mirrored', '你的照片被左右翻轉後拿去用'],
  ['identical', '你的照片被原封不動拿去用'],
  ['face-only', '只有臉像你，其他部分對不上你的照片'],
];

function sentence(tag, e) {
  const outside = e.changedOutsideFace ?? e.changedRatio;
  switch (tag) {
    case 'identical':
      return '照片本身沒有被改動，是直接拿去用的。';
    case 'mirrored':
      return '整張圖被左右翻轉。';
    case 'cropped':
      return `只用了你照片的大約 ${pct(e.refUsed)}，其餘被裁掉。`;
    case 'embedded':
      return `你的照片只占這張圖的大約 ${pct(e.coverage)}，其餘是另外加上去的版面。`;
    case 'overlay':
      return `照片上臉以外的地方，有大約 ${pct(outside)} 被蓋上文字、貼圖或其他內容。`;
    case 'background':
      return `臉以外的地方有大約 ${pct(outside)} 和你的照片不同，背景、衣服或身體可能被換過。`;
    case 'face-intact':
      return '臉的部分和你的照片一致，沒有被改。';
    case 'face-retouched':
      return `臉的部分有大約 ${pct(e.changedInFace)} 被修改過，但看起來仍然是你。`;
    case 'face-replaced':
      return `臉的位置有大約 ${pct(e.changedInFace)} 和你的照片不同，而且那裡現在是另一張臉。`;
    case 'face-hidden':
      return `臉的位置有大約 ${pct(e.changedInFace)} 和你的照片不同，而且那裡偵測不到臉，可能被東西遮住，或被改到認不出來。`;
    case 'face-only':
      return '臉和你相似，但畫面的其他部分對不上你加入的任何一張照片。可能是把你的臉換到別的畫面上、用了你沒加入的照片，或整張重新生成，系統無法分辨是哪一種。';
    default:
      return '';
  }
}

// 回傳 { headline, items: [{ tag, label, text }], labels }；沒有可說的內容時 items 是空的。
export function explainEdit(edit) {
  if (!edit || !edit.tags.length) return { headline: '', items: [], labels: '' };
  const found = HEADLINES.find(([tag]) => edit.tags.includes(tag));
  const items = edit.tags.map((tag) => ({ tag, label: EDIT_LABELS[tag] || tag, text: sentence(tag, edit) }));
  // 摘要不列「臉沒有被改」，除非只有這一項
  const notable = items.filter((i) => i.tag !== 'face-intact');
  return {
    headline: found ? found[1] : '',
    items,
    labels: (notable.length ? notable : items).map((i) => i.label).join('、'),
  };
}
