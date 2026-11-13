// 讀檔案裡的來源標記，看它有沒有被標示為 AI 生成。
//
// 看三種標記：
// 1. C2PA 內容憑證：OpenAI、Adobe Firefly、Google、Microsoft 等工具會寫進檔案。
// 2. IPTC 的 DigitalSourceType：Meta、Midjourney 等會寫在 XMP 中繼資料裡。
// 3. 生成工具的參數：Stable Diffusion WebUI、ComfyUI 會把提示詞與參數寫進 PNG。
//
// 限制：只讀標記，不驗證 C2PA 的數位簽章，所以標記可以被偽造；截圖、轉存、上傳社群平台
// 多半會把標記洗掉，所以「沒有標記」不代表是真的。

const AI_SOURCE_TYPES = [
  // 順序要由長到短，避免短的名稱先在長的名稱裡被找到
  ['compositeWithTrainedAlgorithmicMedia', 'composite', '部分內容由 AI 生成後合成'],
  ['trainedAlgorithmicMedia', 'generated', '由 AI 生成'],
  ['compositeSynthetic', 'composite', '含合成內容'],
  ['algorithmicMedia', 'generated', '由演算法產生'],
];

const KNOWN_TOOLS = [
  'Adobe Firefly',
  'DALL-E',
  'DALL·E',
  'ChatGPT',
  'OpenAI',
  'Midjourney',
  'Imagen',
  'Gemini',
  'Google AI',
  'Stable Diffusion',
  'Microsoft Designer',
  'Bing Image Creator',
  'Meta AI',
  'Leonardo',
  'Flux',
  'Ideogram',
];

// C2PA 的宣告用 CBOR 編碼：鍵名後面緊接著值的長度標頭，再接文字
function findCborText(text, key) {
  let i = text.indexOf(key);
  while (i >= 0) {
    const at = i + key.length;
    const b = text.charCodeAt(at);
    let len = -1;
    let start = at + 1;
    if (b >= 0x60 && b <= 0x77) len = b - 0x60;
    else if (b === 0x78) {
      len = text.charCodeAt(at + 1);
      start = at + 2;
    }
    if (len > 1) {
      const v = text.slice(start, start + len);
      if (/^[\x20-\x7e]+$/.test(v)) return v.slice(0, 80);
    }
    i = text.indexOf(key, at);
  }
  return '';
}

// XMP 的屬性或元素：softwareAgent="…" 或 <…:softwareAgent>…</…>
function findXmpText(text, key) {
  const m = text.match(new RegExp(`${key}="([^"]{2,80})"`)) || text.match(new RegExp(`${key}>([^<]{2,80})<`));
  return m ? m[1].trim() : '';
}

export async function readProvenance(file) {
  const out = { c2pa: false, ai: null, aiText: '', sources: [], tool: '' };
  let text;
  try {
    const buf = await file.arrayBuffer();
    // 只看前 8 MB；中繼資料都在檔案前段或固定區塊裡
    text = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 8 * 1024 * 1024)));
  } catch (_) {
    return out;
  }

  // C2PA 用 JUMBF 盒子包起來，盒子的標籤是 c2pa
  if (text.includes('jumb') && /c2pa/.test(text)) {
    out.c2pa = true;
    out.sources.push('C2PA 內容憑證');
  }

  for (const [key, kind, label] of AI_SOURCE_TYPES) {
    if (text.includes(key)) {
      out.ai = kind;
      out.aiText = label;
      if (!out.c2pa || !text.includes('c2pa.actions')) out.sources.push('IPTC 中繼資料');
      break;
    }
  }

  // Stable Diffusion WebUI 與 ComfyUI 的參數
  if (/parameters\0[\s\S]{0,4000}Steps: \d+[\s\S]{0,400}Sampler:/.test(text) || /"class_type"\s*:\s*"KSampler/.test(text)) {
    out.ai = out.ai || 'generated';
    out.aiText = out.aiText || '由 AI 生成';
    out.sources.push('生成工具的參數');
    out.tool = out.tool || (text.includes('class_type') ? 'ComfyUI' : 'Stable Diffusion WebUI');
  }

  const generator =
    findCborText(text, 'softwareAgent') ||
    findCborText(text, 'claim_generator') ||
    findXmpText(text, 'softwareAgent') ||
    findXmpText(text, 'CreatorTool');
  if (generator) out.tool = out.tool || generator;
  if (!out.tool) {
    const hit = KNOWN_TOOLS.find((t) => text.includes(t));
    if (hit) out.tool = hit;
  }
  return out;
}

// 給畫面用的一句話
export function describeProvenance(p) {
  if (p.ai) {
    const tool = p.tool ? `，工具：${p.tool}` : '';
    return {
      level: 'high',
      title: `檔案標示為「${p.aiText}」`,
      text: `來源：${p.sources.join('、')}${tool}。這是檔案自己帶的標記，沒有驗證簽章。`,
    };
  }
  if (p.c2pa) {
    return {
      level: 'mid',
      title: '檔案帶有內容憑證，但沒有標示 AI 生成',
      text: `內容憑證記錄了檔案的來源與編輯紀錄${p.tool ? `（${p.tool}）` : ''}。沒有驗證簽章。`,
    };
  }
  return {
    level: 'low',
    title: '檔案沒有來源標記',
    text: '截圖、轉存或上傳社群平台通常會洗掉標記，所以沒有標記不代表是真的。',
  };
}
