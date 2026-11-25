// 輔助訊號：讀出圖上的文字，找詐騙廣告常見的話術。
// 文字辨識用 Tesseract.js，在瀏覽器裡執行，圖片不會送出去；語言檔從 jsDelivr 下載（繁中加英文約 4.6 MB）。
// 話術判斷是規則，不是模型：每一條都能指出是哪幾個字命中，方便使用者自己核對。
// 辨識可能漏字或認錯字，所以「沒找到」不代表沒有。

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
export const OCR_LANGS = 'chi_tra+eng';

// strong：單獨出現就值得注意；weak：正常廣告也常見，要和其他項一起出現才算數
// 中文同時列出繁體與簡體的寫法，簡體廣告也能命中
export const SCAM_RULES = [
  {
    id: 'profit',
    label: '保證獲利',
    strength: 'strong',
    text: '投資不可能保證獲利，這是詐騙廣告最常見的說法。',
    patterns: [
      /保[證证]?[獲获]利|保[證证]?[賺赚]|穩[賺赚]|稳[赚賺]|包[賺赚]|[穩稳]定[獲获]利|零[風风][險险]|無[風风][險险]|无[风風][险險]|保本/g,
      /月入\d+[萬万]?|日[賺赚]\d+[萬万]?|周[賺赚]|週[賺赚]|翻倍|[賺赚][翻倍]|\d+\s*%\s*(?:[報报]酬|收益|[獲获]利|回[報报]|利潤|利润)/g,
      /guarantee(?:d)?\s+(?:profits?|returns?|income)|risk[\s-]?free|double\s+your\s+money|no\s+risk/gi,
    ],
  },
  {
    id: 'tips',
    label: '報明牌或帶單',
    strength: 'strong',
    text: '「飆股」「帶單」「內線」是投資詐騙引人加入群組的誘餌。',
    patterns: [
      /[飆飙]股|明牌|[帶带]單|[帶带]单|跟[單单]|內[線线]|内[线線]|主力[資资]金|[漲涨]停|[選选]股[機机]密|[飆飙][漲涨]/g,
      /stock\s+tips?|hot\s+stocks?|insider\s+(?:tips?|info)|trading\s+signals?/gi,
    ],
  },
  {
    id: 'group',
    label: '要你加入群組或私訊',
    strength: 'strong',
    text: '把人從廣告帶到 LINE、WhatsApp、Telegram 群組或私訊，是投資詐騙的固定步驟。',
    patterns: [
      /加\s*(?:LINE|line|Line|賴|赖)|LINE\s*(?:群|ID|官方|好友)|加入.{0,6}群[組组]?|[飛飞]機群|TG\s*群|微信|加好友|私[訊讯信聊]|掃[碼码]|扫[码碼]|掃描.{0,4}(?:QR|條碼|二維碼)/g,
      /WhatsApp|Telegram|\bt\.me\/|\bwa\.me\/|line\.me\/|lin\.ee\//gi,
      /join\s+(?:our|the|my)\s+(?:group|channel|community)|DM\s+me|message\s+me/gi,
    ],
  },
  {
    id: 'money',
    label: '匯款、儲值或虛擬貨幣',
    strength: 'strong',
    text: '要求匯款到個人帳戶、儲值或買虛擬貨幣，常是詐騙的最後一步。',
    patterns: [
      /[匯汇]款|[轉转][帳账賬]|儲值|储值|入金|出金|USDT|泰[達达]幣|比特幣|比特币|[虛虚]擬[貨货][幣币]|虚拟货币|加密[貨货][幣币]/g,
      /\bbitcoin\b|\bcrypto(?:currency)?\b|\bdeposit\b|wire\s+transfer/gi,
    ],
  },
  {
    id: 'free',
    label: '免費領取',
    strength: 'weak',
    text: '用免費的東西換你的聯絡方式。',
    patterns: [/免[費费](?:[領领]取|[領领]|送|[贈赠]|加入|[諮谘]詢|名[額额]|[課课]程)|[贈赠]送|[領领]取.{0,4}(?:股|[資资]料|[報报]告)/g, /free\s+(?:stocks?|signals?|course|gift|consultation)/gi],
  },
  {
    id: 'urgency',
    label: '催你馬上行動',
    strength: 'weak',
    text: '製造時間壓力，讓人來不及查證。',
    patterns: [
      /限[時时]|名[額额]有限|僅剩|仅剩|最後\s*\d|最后\s*\d|倒數|倒数|立即|馬上|马上|今[天日]截止|錯過|错过|手慢無|手慢无/g,
      /act\s+now|limited\s+(?:time|spots|seats)|hurry|last\s+chance/gi,
    ],
  },
  {
    id: 'authority',
    label: '名人或老師背書',
    strength: 'weak',
    text: '冒用名人或「老師」的身分讓人放下戒心。',
    patterns: [/老[師师]|[導导][師师]|分析[師师]|股神|教授|[專专]家|[親亲]自[帶带]|[財财][經经]名人/g, /\bmentor\b|\bexpert\b|\bprofessor\b/gi],
  },
];

// 圖上的聯絡方式：和強訊號一起出現時，結論更明確
const CONTACT_PATTERNS = [
  /(?:LINE|line|Line)\s*(?:ID)?\s*[:：]\s*@?[\w.-]{3,}/g,
  /(?:^|\s)@[a-z0-9._-]{4,}/gi,
  /\b(?:t\.me|wa\.me|line\.me|lin\.ee)\/[\w/+-]+/gi,
  /\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g,
  /\+\d{2,3}[-\s]?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/g,
];

// Tesseract 讀中文常在字與字之間插入空白，先拿掉，英文單字之間的空白保留
export function normalizeText(raw) {
  return String(raw || '')
    .replace(/\r/g, '')
    .replace(/(?<=[㐀-鿿＀-￯])[ \t]+(?=[㐀-鿿＀-￯0-9])/g, '')
    .replace(/(?<=[0-9])[ \t]+(?=[㐀-鿿])/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function collect(text, patterns) {
  const found = new Set();
  for (const re of patterns) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) found.add(m[0].trim());
  }
  return [...found];
}

// 回傳 { level, hits: [{ id, label, strength, text, words }], contacts, text }
// level：none 沒讀到字、low 沒找到、mid 值得注意、high 很像詐騙廣告
export function analyzeScamText(raw) {
  const text = normalizeText(raw);
  // 換行也可能把一個詞拆開，比對時兩種都看
  const joined = text.replace(/\n/g, '');
  const hits = [];
  for (const rule of SCAM_RULES) {
    const words = [...new Set([...collect(text, rule.patterns), ...collect(joined, rule.patterns)])];
    if (words.length) hits.push({ id: rule.id, label: rule.label, strength: rule.strength, text: rule.text, words });
  }
  const all = collect(text, CONTACT_PATTERNS);
  const contacts = all.filter((c) => !all.some((o) => o !== c && o.includes(c)));
  const strong = hits.filter((h) => h.strength === 'strong').length;
  const weak = hits.length - strong;
  let level;
  if (text.replace(/\s/g, '').length < 2) level = 'none';
  else if (strong >= 2 || (strong >= 1 && (contacts.length || weak >= 1))) level = 'high';
  else if (strong >= 1 || weak >= 2) level = 'mid';
  else level = 'low';
  return { level, hits, contacts, text };
}

// 一句話摘要，寫進存證紀錄與文件草稿
export function scamTextSummary(r) {
  if (!r || (r.level !== 'high' && r.level !== 'mid')) return null;
  return `圖上文字出現詐騙常見話術：${r.hits.map((h) => h.label).join('、')}（文字辨識加規則比對，僅供參考）`;
}

let workerPromise = null;

function loadWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = await import(/* @vite-ignore */ TESSERACT);
      const Tesseract = mod.default || mod;
      return Tesseract.createWorker(OCR_LANGS, 1, {
        logger: (m) => onProgress && onProgress(m),
      });
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// 小截圖放大、大圖縮小：長邊在 1200 到 2000 像素之間，辨識率與速度比較平衡
async function prepare(source) {
  const bmp = source instanceof Blob ? await createImageBitmap(source) : source;
  const w = bmp.naturalWidth || bmp.width;
  const h = bmp.naturalHeight || bmp.height;
  const long = Math.max(w, h);
  const scale = long < 1200 ? 1200 / long : long > 2000 ? 2000 / long : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

// source：File、Blob、canvas 或 ImageBitmap
export async function readImageText(source, onProgress) {
  let current = null;
  const worker = await loadWorker((m) => current && current(m));
  current = onProgress;
  const canvas = await prepare(source);
  const { data } = await worker.recognize(canvas);
  current = null;
  return data.text || '';
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 按鈕：讀出圖上的文字，列出命中的話術。
// els：{ button, line, hits, textWrap, text }；getSource 回傳要讀的圖；onResult(result) 可以回傳一句「下一步」
export function setupScamTextButton(els, getSource, onResult) {
  const { button, line, hits, textWrap, text } = els;
  button.addEventListener('click', async () => {
    const source = getSource();
    if (!source) return;
    button.disabled = true;
    hits.innerHTML = '';
    textWrap.hidden = true;
    line.className = 'result-line';
    line.textContent = '正在下載文字辨識的語言檔（約 5 MB，第一次需要等一下）';
    try {
      const raw = await readImageText(source, (m) => {
        if (m.status === 'recognizing text') line.textContent = `正在讀圖上的文字：${Math.round(m.progress * 100)}%`;
      });
      const r = analyzeScamText(raw);
      const next = onResult ? onResult(r) || '' : '';
      showScamText(els, r, next);
    } catch (err) {
      console.error(err);
      line.className = 'result-line bad';
      line.textContent = '文字辨識載入失敗，請稍後再試。';
      button.disabled = false;
    }
  });
}

export function resetScamText({ button, line, hits, textWrap }) {
  button.disabled = false;
  line.className = 'result-line';
  line.textContent = '';
  hits.innerHTML = '';
  textWrap.hidden = true;
}

function showScamText({ line, hits, textWrap, text }, r, next) {
  const names = r.hits.map((h) => h.label).join('、');
  if (r.level === 'none') {
    line.className = 'result-line';
    line.textContent = `圖上讀不到文字。字太小、太糊或是藝術字時會讀不出來。${next}`;
  } else if (r.level === 'high') {
    line.className = 'result-line bad';
    line.textContent = `圖上的文字很像投資詐騙廣告：出現「${names}」。${next}`;
  } else if (r.level === 'mid') {
    line.className = 'result-line';
    line.textContent = `圖上的文字有值得注意的說法：「${names}」。單看文字還不能確定。${next}`;
  } else {
    line.className = 'result-line';
    line.textContent = `圖上的文字沒有找到常見的詐騙話術${r.hits.length ? `，只有「${names}」這類一般廣告也常見的說法` : ''}。這不代表沒問題：字可能沒讀清楚，或用了別的說法。${next}`;
  }
  const rows = r.hits
    .filter((h) => r.level === 'high' || r.level === 'mid' || h.strength === 'strong')
    .map((h) => `<li class="${h.strength === 'strong' ? 'alert' : ''}"><strong>${esc(h.label)}</strong>圖上寫著「${h.words.slice(0, 4).map(esc).join('」「')}」。${esc(h.text)}</li>`);
  if (r.contacts.length && (r.level === 'high' || r.level === 'mid')) {
    rows.push(`<li><strong>圖上的聯絡方式</strong>${r.contacts.slice(0, 4).map(esc).join('、')}。不要加入，也不要私訊；可以把它記在檢舉或報案資料裡。</li>`);
  }
  hits.innerHTML = rows.join('');
  if (r.text) {
    text.textContent = r.text;
    textWrap.hidden = false;
  }
}
