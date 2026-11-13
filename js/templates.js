// 情境分類、法律路徑說明與文件範本。
// 這裡的法律文字是原型草稿，尚未經法律成員審核，不是法律意見。

export const SCENARIOS = {
  scam: {
    label: '詐騙或投資廣告冒用',
    hint: '有人用你的照片或影片冒充老師、專家，招攬投資或加入群組',
  },
  endorsement: {
    label: '假代言或未授權的商業使用',
    hint: '你的肖像被用在你沒有同意的商品或服務廣告上',
  },
  intimate: {
    label: '被合成的不雅影像',
    hint: '你的照片被改造成不雅內容',
  },
  other: {
    label: '其他未經同意的使用',
    hint: '不屬於以上三種',
  },
};

export function legalPath(scenario) {
  const civil = {
    title: '民事：請求停止侵害與賠償',
    body:
      '肖像與姓名屬於人格權。可以請求對方停止使用；情節重大時可以請求精神慰撫金。',
    basis: '民法第 18 條、第 19 條、第 184 條、第 195 條',
  };
  if (scenario === 'scam') {
    return [
      {
        title: '向平台檢舉並要求移除廣告',
        body:
          '廣告平台知道廣告涉及詐欺時，應移除或停止播送，並把刊登者的資訊提供給司法警察機關。廣告也應揭露委託刊播者與出資者，以及是否使用深偽或 AI 生成的個人影像；沒有揭露的，可以一併檢舉。',
        basis: '詐欺犯罪危害防制條例（條號待核對）',
      },
      {
        title: '通報與報案',
        body:
          '撥打 165 反詐騙專線通報，並到派出所報案留下紀錄。報案紀錄也能在日後證明你不是廣告的刊登者。',
        basis: '',
      },
      {
        title: '對外澄清',
        body: '在你自己的官方管道發布聲明，說明該廣告與你無關，提醒大眾不要受騙。',
        basis: '',
      },
      civil,
    ];
  }
  if (scenario === 'endorsement') {
    return [
      {
        title: '向平台檢舉並要求移除',
        body: '以未經授權使用肖像為由檢舉，並保留檢舉紀錄。',
        basis: '',
      },
      {
        title: '通知使用者停止使用',
        body: '以書面要求對方停止使用並說明授權來源。是否寄發存證信函，建議先諮詢律師。',
        basis: '',
      },
      civil,
    ];
  }
  if (scenario === 'intimate') {
    return [
      {
        title: '申請下架',
        body:
          '向衛生福利部性影像處理中心申訴，中心會通知平台限制瀏覽或移除；也可以同時使用平台的檢舉功能。',
        basis: '性侵害犯罪防治法第 13 條',
      },
      {
        title: '刑事：報案',
        body:
          '以電腦合成等方法製作他人不實性影像並意圖散布，或散布這類影像，是犯罪行為。可到派出所或婦幼警察隊報案，或先撥 113 由社工協助。',
        basis: '刑法第 319 條之 4',
      },
      civil,
    ];
  }
  return [civil];
}

function line(label, value) {
  return value ? `${label}：${value}` : `${label}：（請填寫）`;
}

function evidenceLines(c) {
  const out = [
    line('來源網址', c.sourceUrl),
    line('平台', c.platform),
    line('帳號或粉專名稱', c.account),
  ];
  if (c.scenario === 'scam' || c.scenario === 'endorsement') {
    out.push(line('廣告上揭露的刊登者或出資者', c.advertiser));
  }
  out.push(line('發現時間', c.foundAt));
  if (c.suspect) out.push(`可疑影像檔案 SHA-256：${c.suspect.sha256}`);
  if (c.match) out.push(`比對結果：${c.match.summary}`);
  const s = c.signals || {};
  const other = [s.provenance, s.swap, s.ai].filter(Boolean);
  if (other.length) out.push(`其他線索（輔助，非判定）：${other.join('；')}`);
  return out;
}

export function buildDocuments(c) {
  const docs = [];
  const name = c.displayName || '（你的姓名或對外使用的名稱）';
  const ev = evidenceLines(c).join('\n');

  if (c.scenario === 'scam') {
    docs.push({
      title: '平台檢舉文字',
      note: '貼到平台的檢舉表單。',
      text: `我是${name}本人。下列廣告未經我同意使用我的肖像，並冒用我的名義招攬投資，內容涉及詐欺，請立即移除，並保留刊登者的相關資料以供警方調查。\n\n${ev}\n\n我可以提供原始照片與身分證明文件供查驗。`,
    });
    docs.push({
      title: '165 通報與報案摘要',
      note: '撥打 165 或到派出所時，可以直接出示或照著說明。',
      text: `報案人：${name}\n事由：肖像遭冒用於疑似詐騙廣告\n\n經過：我於${c.foundAt || '（時間）'}發現下列廣告使用我的照片或影片，冒充我本人招攬投資。我從未刊登或授權該廣告，也沒有經營廣告所稱的群組或課程。\n\n${ev}\n\n我已保存廣告截圖、原始照片，以及兩者的比對結果，可提供給警方。\n\n請求：受理報案並協助通知平台移除廣告；請提供報案證明，以便我日後說明自己與該廣告無關。`,
    });
    docs.push({
      title: '澄清聲明草稿',
      note: '發布在你自己的官方帳號或網站。發布前請自行確認內容。',
      text: `【聲明】近期發現有廣告冒用我的照片與名義招攬投資。\n\n該廣告與我本人無關。我沒有開設廣告所稱的投資群組，也不會私下邀請任何人加入群組或提供投資建議。\n\n我已向平台檢舉並報案。如果你看到類似內容，請不要點擊、不要加入群組、不要匯款，並可撥打 165 反詐騙專線查證。\n\n${name}\n${new Date().toLocaleDateString('zh-TW')}`,
    });
  } else if (c.scenario === 'endorsement') {
    docs.push({
      title: '平台檢舉文字',
      note: '貼到平台的檢舉表單。',
      text: `我是${name}本人。下列內容未經我同意，使用我的肖像為商品或服務宣傳。我沒有授權，也沒有代言。請移除該內容。\n\n${ev}\n\n我可以提供原始照片與身分證明文件供查驗。`,
    });
    docs.push({
      title: '事件摘要',
      note: '諮詢律師或法律扶助時使用。',
      text: `當事人：${name}\n事由：肖像遭未經授權用於商業宣傳\n\n經過：我於${c.foundAt || '（時間）'}發現下列內容使用我的肖像。我沒有與該業者簽約或授權。\n\n${ev}\n\n想詢問的事項：可否請求停止使用與賠償；是否適合寄發存證信函。`,
    });
  } else if (c.scenario === 'intimate') {
    docs.push({
      title: '平台檢舉文字',
      note: '選擇平台的「未經同意的私密影像」檢舉類別後貼上。',
      text: `下列內容是未經我同意、以我的照片合成的不實性影像，請立即移除並保留相關資料以供警方調查。\n\n${ev}`,
    });
    docs.push({
      title: '報案摘要',
      note: '到派出所或婦幼警察隊時可以直接出示，減少口頭重述。也可以先撥 113 請社工陪同。',
      text: `事由：遭他人以電腦合成方式製作並散布不實性影像\n\n經過：我於${c.foundAt || '（時間）'}得知下列位置出現以我的照片合成的不雅影像。影像內容不是真實的，我沒有同意任何人製作或散布。\n\n${ev}\n\n我已保存來源資訊與比對結果，可提供給警方。\n\n請求：受理報案，並協助向平台調取散布者的資料。`,
    });
  } else {
    docs.push({
      title: '事件摘要',
      note: '諮詢律師或法律扶助時使用。',
      text: `當事人：${name}\n事由：肖像遭未經同意使用\n\n${ev}`,
    });
  }
  return docs;
}

export const RESOURCES = {
  common: [
    { name: '165 反詐騙專線', detail: '詐騙通報與查證', tel: '165' },
    { name: '110', detail: '有立即危險時報警', tel: '110' },
    { name: '法律扶助基金會', detail: '符合資格可申請免費律師', url: 'https://www.laf.org.tw' },
  ],
  intimate: [
    { name: '113 保護專線', detail: '社工可以說明流程並陪同報案', tel: '113' },
    { name: '衛生福利部性影像處理中心', detail: '受理下架申訴' },
  ],
};
