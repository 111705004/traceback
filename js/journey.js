// 旅程場景：被冒用的人走過「準備 → 發現 → 比對 → 存證 → 報案」五段路。
// 做法參考 svg-scene-maker：viewBox 1600×600、剪紙層疊畫風、顏色全部放在 CSS 變數、
// 可以點的物件可用鍵盤操作、支援減少動態。白天、夜晚跟著網站的淺色、深色外觀。
// 整條街是 5 段 × 1600 寬，鏡頭跟著目前的步驟平移，人物在畫面中央走路。

const W = 1600;
const GROUND = 470;

// 每個步驟對應哪一段路
export const STAGE_OF = { bind: 0, library: 0, idcheck: 0, search: 1, case: 1, result: 2, evidence: 3, action: 4 };
export const STAGES = ['準備', '發現', '比對', '存證', '報案'];

// 點了之後畫面下方的說明。不點也能完成流程，這些只是陪伴與提示。
const SAY = {
  mirror: '先用鏡頭自拍，讓系統認得你的臉。之後加入的照片都要是同一張臉。',
  photos: '加入你公開用過的照片。最常被盜用的是大頭照和活動照。',
  cat: '慢慢來，不用急。每一步都可以回上一步。',
  billboard: '看到可疑廣告：先截圖，記下網址和帳號名稱，不要點連結、不要加群組。',
  pigeon: '',
  magnifier: '系統用四種方法比對，被裁切、翻轉、加字的圖也認得出來。',
  lamp: '比對在你的裝置上進行，照片不會上傳。',
  bag: '每個檔案都會算出 SHA-256 數位指紋，之後只要被改過一點都看得出來。',
  clock: '記下你發現的時間。目前的時間取自你的裝置時鐘。',
  door: '帶著存證紀錄到派出所報案，或先打 165 反詐騙專線諮詢。',
  poster: '165 是反詐騙諮詢專線，可以先打去問問看。',
  scooter: '',
};

const hit = (id, label, inner) =>
  `<g class="hit" data-hit="${id}" tabindex="0" role="button" aria-label="${label}">${inner}</g>`;

// ---------- 場景：遠景（視差較慢）----------
function farLayer() {
  let hills = '';
  for (let i = 0; i < 8; i++) {
    const x = i * 700 - 200;
    hills += `<path class="j-far" d="M${x} 400 Q${x + 180} ${250 + (i % 3) * 30} ${x + 380} 380 T${x + 820} 390 V470 H${x} Z"/>`;
  }
  let sky = '';
  for (let i = 0; i < 12; i++) {
    const x = i * 420 + 60;
    const y = 70 + ((i * 37) % 90);
    sky += `<g class="j-cloud" style="--d:${38 + (i % 4) * 9}s"><path class="j-cloud-p" d="M${x} ${y}h150a26 26 0 0 0-30-34 34 34 0 0 0-62-8 24 24 0 0 0-46 18 20 20 0 0 0-12 24Z"/></g>`;
    sky += `<circle class="j-star" cx="${x + 210}" cy="${40 + ((i * 53) % 120)}" r="2.2"/><circle class="j-star" cx="${x + 330}" cy="${30 + ((i * 29) % 80)}" r="1.6"/>`;
  }
  return `<g class="j-farlayer">${sky}${hills}</g>`;
}

// ---------- 場景：第 0 段，家（準備）----------
function zoneHome(x) {
  return `<g transform="translate(${x} 0)">
    <path class="j-roof j-paper" d="M140 150 L800 40 L1460 150 Z"/>
    <rect class="j-wall j-paper" x="180" y="150" width="1240" height="${GROUND - 150}"/>
    <rect class="j-floor" x="180" y="430" width="1240" height="40"/>
    <line class="j-cord" x1="800" y1="150" x2="800" y2="200"/>
    <path class="j-lampshade j-paper" d="M770 200h60l18 34h-96Z"/><ellipse class="j-glow" cx="800" cy="260" rx="120" ry="60"/>
    <rect class="j-window-frame j-paper" x="1140" y="190" width="200" height="150" rx="6"/>
    <rect class="j-window" x="1152" y="202" width="176" height="126"/>
    <circle class="j-moon" cx="1290" cy="236" r="16"/>
    <line class="j-mullion" x1="1240" y1="202" x2="1240" y2="328"/>
    ${hit('mirror', '鏡子：先確認是你本人', `
      <ellipse class="j-mirror-frame j-paper" cx="400" cy="300" rx="70" ry="100"/>
      <ellipse class="j-mirror" cx="400" cy="300" rx="56" ry="86"/>
      <path class="j-shine" d="M370 250 l20 -20 M366 280 l38 -38"/>
      <circle class="j-mirror-face" cx="400" cy="300" r="22"/>`)}
    ${hit('photos', '相框：加入你的照片', `
      <g class="j-frame f1"><rect class="j-paper j-card" x="590" y="230" width="90" height="110" rx="4"/><rect class="j-photo" x="600" y="240" width="70" height="70"/><circle class="j-skin" cx="635" cy="268" r="13"/><path class="j-shirt" d="M612 310c4-14 13-20 23-20s19 6 23 20Z"/></g>
      <g class="j-frame f2"><rect class="j-paper j-card" x="700" y="260" width="80" height="96" rx="4"/><rect class="j-photo alt" x="709" y="269" width="62" height="60"/><circle class="j-skin" cx="740" cy="293" r="11"/><path class="j-shirt" d="M719 329c4-12 11-17 21-17s17 5 21 17Z"/></g>`)}
    <rect class="j-desk j-paper" x="880" y="360" width="200" height="16" rx="4"/><rect class="j-desk" x="896" y="376" width="12" height="54"/><rect class="j-desk" x="1052" y="376" width="12" height="54"/>
    <rect class="j-laptop" x="930" y="318" width="96" height="42" rx="4"/><rect class="j-laptop-screen" x="936" y="323" width="84" height="32" rx="2"/>
    <ellipse class="j-rug" cx="1260" cy="452" rx="130" ry="16"/>
    ${hit('cat', '貓：休息一下', `
      <g class="j-cat"><ellipse class="j-cat-body" cx="1260" cy="430" rx="48" ry="22"/><circle class="j-cat-body" cx="1220" cy="414" r="18"/>
      <path class="j-cat-body" d="M1206 402l4-16 10 12Z M1226 398l8-14 4 16Z"/><path class="j-cat-tail" d="M1306 430q30-6 26-40"/></g>`)}
  </g>`;
}

// ---------- 場景：第 1 段，街上（發現）----------
function zoneStreet(x) {
  let bldg = '';
  [[60, 150, 150], [240, 210, 120], [1210, 120, 170], [1400, 190, 130]].forEach(([bx, top, w], i) => {
    bldg += `<rect class="j-bldg j-paper ${i % 2 ? 'alt' : ''}" x="${bx}" y="${top}" width="${w}" height="${GROUND - top}"/>`;
    for (let r = top + 24; r < GROUND - 40; r += 46) for (let c = bx + 18; c < bx + w - 26; c += 38)
      bldg += `<rect class="j-win" x="${c}" y="${r}" width="18" height="24" rx="2"/>`;
  });
  return `<g transform="translate(${x} 0)">
    ${bldg}
    <path class="j-wire" d="M380 150 Q 640 190 900 150"/>
    ${hit('pigeon', '電線上的鴿子', `<g class="j-pigeon"><ellipse class="j-bird" cx="640" cy="160" rx="16" ry="10"/><circle class="j-bird" cx="654" cy="152" r="7"/><path class="j-beak" d="M660 152l8 2-8 2Z"/></g>`)}
    <rect class="j-pole" x="895" y="140" width="10" height="${GROUND - 140}"/>
    ${hit('billboard', '路邊的可疑廣告看板', `
      <g class="j-board">
        <rect class="j-paper j-board-bg" x="690" y="200" width="420" height="200" rx="10"/>
        <rect class="j-ad" x="706" y="216" width="388" height="168" rx="6"/>
        <circle class="j-skin" cx="790" cy="280" r="34"/><path class="j-suit" d="M740 384c8-40 26-58 50-58s42 18 50 58Z"/>
        <text class="j-ad-text" x="990" y="270" text-anchor="middle">保證獲利</text>
        <text class="j-ad-sub" x="990" y="310" text-anchor="middle">加入群組領飆股</text>
        <rect class="j-ad-btn" x="930" y="330" width="120" height="30" rx="15"/>
        <circle class="j-lens-ring" cx="790" cy="280" r="52"/>
      </g>`)}
    <rect class="j-pole" x="1050" y="400" width="8" height="70"/><rect class="j-pole" x="742" y="400" width="8" height="70"/>
    <rect class="j-lamp-post" x="520" y="250" width="8" height="220"/><path class="j-lamp-head j-paper" d="M500 250h48l-8-22h-32Z"/><ellipse class="j-streetglow" cx="524" cy="300" rx="70" ry="40"/>
    <path class="j-tree j-paper" d="M1150 300 q-60-10-50-70 q10-60 70-60 q60 0 70 60 q10 60-50 70Z"/><rect class="j-trunk" x="1164" y="296" width="12" height="174"/>
  </g>`;
}

// ---------- 場景：第 2 段，工作桌（比對）----------
function zoneDesk(x) {
  return `<g transform="translate(${x} 0)">
    <rect class="j-wall j-paper alt" x="160" y="120" width="1280" height="${GROUND - 120}"/>
    <path class="j-awning" d="M140 120h1320l-30 46H170Z"/>
    <rect class="j-board-cork j-paper" x="260" y="190" width="300" height="170" rx="6"/>
    <rect class="j-note" x="285" y="210" width="80" height="60" transform="rotate(-4 325 240)"/><rect class="j-note alt" x="380" y="220" width="70" height="56" transform="rotate(5 415 248)"/><rect class="j-note" x="465" y="205" width="70" height="70" transform="rotate(-2 500 240)"/>
    <path class="j-string" d="M325 240 L415 248 L500 240"/>
    <rect class="j-desk j-paper" x="600" y="352" width="620" height="20" rx="6"/><rect class="j-desk" x="630" y="372" width="14" height="98"/><rect class="j-desk" x="1176" y="372" width="14" height="98"/>
    <g class="j-photo-pair">
      <rect class="j-paper j-card" x="680" y="262" width="110" height="90" rx="4"/><rect class="j-photo" x="690" y="272" width="90" height="70"/><circle class="j-skin" cx="735" cy="300" r="15"/><path class="j-shirt" d="M712 342c5-15 13-22 23-22s18 7 23 22Z"/>
      <rect class="j-paper j-card" x="830" y="262" width="110" height="90" rx="4" transform="rotate(4 885 307)"/><rect class="j-ad" x="840" y="272" width="90" height="70" transform="rotate(4 885 307)"/><circle class="j-skin" cx="885" cy="302" r="15"/><rect class="j-ad-btn" x="850" y="326" width="70" height="10" rx="5" transform="rotate(4 885 307)"/>
    </g>
    ${hit('magnifier', '放大鏡：比對兩張圖', `<g class="j-magnifier"><circle class="j-lens" cx="1010" cy="300" r="40"/><path class="j-handle" d="M1038 328l40 40"/></g>`)}
    ${hit('lamp', '檯燈', `<g class="j-desklamp"><path class="j-lamp-arm" d="M1140 352 L1110 250 L1170 210"/><path class="j-lampshade j-paper" d="M1150 200l50 6-12 34-48-12Z"/><path class="j-desk-light" d="M1170 238 L1060 352 H1240 Z"/></g>`)}
  </g>`;
}

// ---------- 場景：第 3 段，證物室（存證）----------
function zoneEvidence(x) {
  return `<g transform="translate(${x} 0)">
    <rect class="j-wall j-paper" x="160" y="140" width="1280" height="${GROUND - 140}"/>
    <path class="j-roof j-paper" d="M130 140 L800 70 L1470 140 Z"/>
    <rect class="j-cabinet j-paper" x="260" y="230" width="190" height="240" rx="6"/>
    <rect class="j-drawer" x="276" y="248" width="158" height="62" rx="4"/><rect class="j-drawer" x="276" y="322" width="158" height="62" rx="4"/><rect class="j-drawer" x="276" y="396" width="158" height="62" rx="4"/>
    <rect class="j-desk j-paper" x="560" y="360" width="560" height="20" rx="6"/><rect class="j-desk" x="590" y="380" width="14" height="90"/><rect class="j-desk" x="1076" y="380" width="14" height="90"/>
    ${hit('bag', '證物袋：封存並算出數位指紋', `
      <g class="j-bag"><rect class="j-bag-body" x="640" y="230" width="190" height="130" rx="6"/><rect class="j-bag-seal" x="640" y="230" width="190" height="20" rx="6"/>
      <rect class="j-ad" x="670" y="268" width="80" height="64"/><circle class="j-skin" cx="710" cy="292" r="12"/>
      <g class="j-stamp"><rect class="j-stamp-box" x="762" y="290" width="54" height="40" rx="4" transform="rotate(-10 789 310)"/><text class="j-stamp-text" x="789" y="316" text-anchor="middle" transform="rotate(-10 789 310)">SHA</text></g></g>`)}
    ${hit('clock', '時鐘：記下發現的時間', `
      <g class="j-clock"><circle class="j-paper j-clock-face" cx="980" cy="230" r="56"/>
      <g class="j-hand-h"><line x1="980" y1="230" x2="980" y2="198"/></g><g class="j-hand-m"><line x1="980" y1="230" x2="1010" y2="230"/></g><circle class="j-clock-pin" cx="980" cy="230" r="5"/></g>`)}
    <rect class="j-folder j-paper" x="880" y="318" width="150" height="42" rx="4"/><rect class="j-folder-tab" x="890" y="308" width="56" height="14" rx="3"/>
    <rect class="j-window-frame j-paper" x="1180" y="200" width="180" height="150" rx="6"/><rect class="j-window" x="1192" y="212" width="156" height="126"/>
  </g>`;
}

// ---------- 場景：第 4 段，派出所（報案）----------
function zonePolice(x) {
  return `<g transform="translate(${x} 0)">
    <rect class="j-station j-paper" x="300" y="150" width="1000" height="${GROUND - 150}"/>
    <rect class="j-station-band" x="300" y="150" width="1000" height="54"/>
    <text class="j-sign" x="800" y="190" text-anchor="middle">派出所</text>
    <rect class="j-win lit" x="360" y="240" width="120" height="90" rx="4"/><rect class="j-win lit" x="1120" y="240" width="120" height="90" rx="4"/>
    ${hit('door', '派出所的門：走進去報案', `
      <g class="j-doorway"><rect class="j-door-hole" x="700" y="280" width="200" height="190"/><rect class="j-door-light" x="700" y="280" width="200" height="190"/>
      <rect class="j-door l" x="700" y="280" width="100" height="190"/><rect class="j-door r" x="800" y="280" width="100" height="190"/>
      <rect class="j-step j-paper" x="680" y="458" width="240" height="12"/></g>`)}
    ${hit('poster', '牆上的 165 海報', `<g class="j-poster"><rect class="j-paper j-poster-bg" x="540" y="250" width="110" height="140" rx="4"/><text class="j-poster-num" x="595" y="320" text-anchor="middle">165</text><rect class="j-poster-line" x="560" y="340" width="70" height="8" rx="4"/><rect class="j-poster-line" x="560" y="356" width="50" height="8" rx="4"/></g>`)}
    <path class="j-plant j-paper" d="M980 440 q-40-60 0-110 q40 50 0 110Z M960 440 q-50-30-40-80 q40 20 40 80Z"/><rect class="j-pot" x="960" y="430" width="40" height="40" rx="4"/>
    ${hit('scooter', '停在門口的機車', `<g class="j-scooter"><circle class="j-wheel" cx="1340" cy="452" r="18"/><circle class="j-wheel" cx="1450" cy="452" r="18"/><path class="j-scooter-body j-paper" d="M1330 440 h70 l20 -50 h20 l-10 50 h30 v-16 h-40"/><rect class="j-seat" x="1340" y="420" width="60" height="12" rx="6"/><circle class="j-headlight" cx="1446" cy="398" r="7"/></g>`)}
    <rect class="j-lamp-post" x="200" y="250" width="8" height="220"/><path class="j-lamp-head j-paper" d="M180 250h48l-8-22h-32Z"/><ellipse class="j-streetglow" cx="204" cy="300" rx="70" ry="40"/>
  </g>`;
}

// ---------- 角色：走路的人（固定在畫面中央）----------
function walker() {
  return `<g class="j-walker">
    <ellipse class="j-shadow" cx="0" cy="0" rx="34" ry="6"/>
    <g class="j-leg back"><path d="M-4 -70 L-6 -2"/></g><g class="j-leg front"><path d="M4 -70 L6 -2"/></g>
    <path class="j-coat j-paper" d="M-26 -60 Q-28 -118 0 -122 Q28 -118 26 -60 Z"/>
    <g class="j-arm back"><path d="M-20 -110 L-26 -66"/></g><g class="j-arm front"><path d="M20 -110 L26 -66"/></g>
    <rect class="j-phone" x="22" y="-76" width="10" height="16" rx="2"/>
    <circle class="j-skin j-head" cx="0" cy="-140" r="20"/><path class="j-hair" d="M-20 -142 Q-18 -164 0 -164 Q20 -164 20 -142 Q10 -152 -20 -142Z"/>
  </g>`;
}

// 被冒用的人：準備 → 發現 → 比對 → 存證 → 報案
export const VICTIM = {
  stages: STAGES,
  say: SAY,
  label: '你一路從家裡出發，發現可疑廣告、比對、存證，最後到派出所報案',
  zones: [zoneHome, zoneStreet, zoneDesk, zoneEvidence, zonePolice],
  show: {
    hit: 'door',
    start: '帶著存證紀錄到派出所報案，或先打 165 反詐騙專線諮詢。',
    stop: '停下來了。準備好再進去也可以。',
    // [時間（毫秒）, 加上的 class, 拿掉的 class, 人物要不要走路]
    steps: [[600, 'show-enter', '', true], [2600, '', '', false], [5200, 'show-return', 'show-enter', true], [7200]],
  },
};

export function mountJourney(figure, cfg = VICTIM) {
  const zones = cfg.zones.map((fn, i) => fn(W * i)).join('');
  const n = cfg.zones.length;
  // 每個場景自己的濾鏡 id，同一頁有好幾幅也不會互相引用
  const uid = `j${Math.random().toString(36).slice(2, 8)}`;
  figure.innerHTML = `
    <ol class="journey-stages" aria-label="旅程">${cfg.stages.map((s, i) => `<li data-stage="${i}">${s}</li>`).join('')}</ol>
    <div class="journey-stage">
      <svg class="journey-svg" style="--j-filter: url(#${uid}-shadow)" viewBox="0 0 ${W} 600" role="img" aria-label="${cfg.label}">
        <defs>
          <filter id="${uid}-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#000" flood-opacity=".18"/></filter>
          <radialGradient id="${uid}-cine" cx="50%" cy="55%" r="70%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/></radialGradient>
        </defs>
        <rect class="j-sky" width="${W}" height="600"/>
        <g class="j-parallax">${farLayer()}</g>
        <g class="j-world">
          ${zones}
          <rect class="j-ground" x="-200" y="${GROUND}" width="${W * n + 400}" height="130"/>
          <rect class="j-curb" x="-200" y="${GROUND}" width="${W * n + 400}" height="10"/>
          <rect class="j-road" x="-200" y="520" width="${W * n + 400}" height="80"/>
          <line class="j-road-line" x1="-200" y1="562" x2="${W * n + 200}" y2="562"/>
          <line class="j-tiles" x1="-200" y1="496" x2="${W * n + 200}" y2="496"/>
        </g>
        ${walker()}
        <rect class="j-cine" width="${W}" height="600" fill="url(#${uid}-cine)" pointer-events="none"/>
      </svg>
    </div>
    <p class="journey-say" aria-live="polite">點畫面裡的東西看看。</p>`;

  const svg = figure.querySelector('svg');
  const world = svg.querySelector('.j-world');
  const far = svg.querySelector('.j-parallax');
  const walkerEl = svg.querySelector('.j-walker');
  const say = figure.querySelector('.journey-say');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let stage = -1;
  let walkTimer = 0;
  let mx = 0;
  let showTimers = [];

  // 鏡頭平移：人物站在畫面左側三分之一，世界往左移
  function place() {
    const base = stage < 0 ? 0 : stage * W;
    world.style.transform = `translateX(${-base - mx * 14}px)`;
    far.style.transform = `translateX(${-base * 0.35 - mx * 5}px)`;
  }

  function go(next) {
    if (next === stage) return;
    const first = stage < 0;
    if (showOn()) endShow();
    stage = next;
    svg.classList.toggle('no-anim', first || reduce.matches);
    place();
    figure.querySelectorAll('.journey-stages li').forEach((li, i) => {
      li.classList.toggle('done', i < stage);
      li.toggleAttribute('aria-current', i === stage);
      if (i === stage) li.setAttribute('aria-current', 'step');
    });
    say.textContent = '點畫面裡的東西看看。';
    clearTimeout(walkTimer);
    if (!first && !reduce.matches) {
      walkerEl.classList.add('walking');
      walkTimer = setTimeout(() => walkerEl.classList.remove('walking'), 1700);
    }
    if (first) requestAnimationFrame(() => svg.classList.toggle('no-anim', reduce.matches));
  }

  // 滑鼠視差：輕輕的，遠景動得少、近景動得多
  svg.addEventListener('pointermove', (e) => {
    if (reduce.matches) return;
    const r = svg.getBoundingClientRect();
    mx = (e.clientX - r.left) / r.width - 0.5;
    svg.classList.add('no-anim');
    place();
  });
  svg.addEventListener('pointerleave', () => {
    mx = 0;
    svg.classList.remove('no-anim');
    place();
  });

  // ---------- 互動 ----------
  function react(el) {
    const id = el.dataset.hit;
    if (cfg.show && id === cfg.show.hit) return toggleShow(el);
    if (id === 'lamp') el.classList.toggle('off');
    else {
      el.classList.remove('play');
      void el.getBBox();
      el.classList.add('play');
    }
    if (cfg.say[id]) say.textContent = cfg.say[id];
  }
  svg.querySelectorAll('.hit').forEach((el) => {
    el.addEventListener('click', () => react(el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        react(el);
      }
    });
    el.addEventListener('animationend', (e) => {
      if (e.target !== el && el.contains(e.target) && el.dataset.hit === 'bag') el.classList.add('stamped');
      el.classList.remove('play');
    });
  });

  // ---------- 秀 ----------
  // 依 cfg.show.steps 的時間表加減 class；再按一次同一個東西就停止。
  const SHOW_CLASSES = ['show-on', 'show-enter', 'show-return', 'show-send', 'show-arrive'];
  function showOn() {
    return svg.classList.contains('show-on');
  }
  function endShow() {
    showTimers.forEach(clearTimeout);
    showTimers = [];
    svg.classList.remove(...SHOW_CLASSES);
    walkerEl.classList.remove('walking');
  }
  function toggleShow() {
    if (showOn()) {
      endShow();
      say.textContent = cfg.show.stop;
      return;
    }
    say.textContent = cfg.show.start;
    if (reduce.matches) return;
    svg.classList.add('show-on');
    for (const [ms, add, remove, walk] of cfg.show.steps) {
      showTimers.push(
        setTimeout(() => {
          if (add === undefined) return endShow();
          if (remove) svg.classList.remove(remove);
          if (add) svg.classList.add(add);
          walkerEl.classList.toggle('walking', !!walk);
        }, ms),
      );
    }
  }

  // 分頁看不到時暫停環境動畫
  document.addEventListener('visibilitychange', () => svg.classList.toggle('paused', document.hidden));

  return { go, hide: () => endShow() };
}

// ======================================================================
// 民眾查證：看到 → 查證 → 交給本人
// ======================================================================

// ---------- 場景：第 0 段，公車站（看到可疑廣告）----------
function zoneBusStop(x) {
  let bldg = '';
  [[40, 170, 160], [1300, 140, 180]].forEach(([bx, top, w], i) => {
    bldg += `<rect class="j-bldg j-paper ${i ? 'alt' : ''}" x="${bx}" y="${top}" width="${w}" height="${GROUND - top}"/>`;
    for (let r = top + 24; r < GROUND - 40; r += 46) for (let c = bx + 18; c < bx + w - 26; c += 38)
      bldg += `<rect class="j-win" x="${c}" y="${r}" width="18" height="24" rx="2"/>`;
  });
  return `<g transform="translate(${x} 0)">
    ${bldg}
    <path class="j-shelter j-paper" d="M300 250h420l-20-30H320Z"/><rect class="j-pole" x="320" y="250" width="10" height="220"/><rect class="j-pole" x="690" y="250" width="10" height="220"/>
    <rect class="j-bench j-paper" x="380" y="400" width="240" height="14" rx="5"/><rect class="j-desk" x="400" y="414" width="10" height="56"/><rect class="j-desk" x="590" y="414" width="10" height="56"/>
    ${hit('phonead', '手機上的可疑廣告', `
      <g class="j-bubble"><path class="j-paper j-bubble-bg" d="M760 110h300a20 20 0 0 1 20 20v170a20 20 0 0 1-20 20H860l-60 40 14-40h-54a20 20 0 0 1-20-20V130a20 20 0 0 1 20-20Z"/>
      <rect class="j-ad" x="776" y="126" width="288" height="178" rx="10"/>
      <circle class="j-skin" cx="840" cy="196" r="30"/><path class="j-suit" d="M798 290c6-36 22-52 42-52s36 16 42 52Z"/>
      <text class="j-ad-text small" x="980" y="190" text-anchor="middle">股神老師</text>
      <text class="j-ad-sub" x="980" y="226" text-anchor="middle">加 LINE 領飆股</text>
      <rect class="j-ad-btn" x="925" y="250" width="110" height="28" rx="14"/></g>`)}
    ${hit('atm', '提款機', `<g class="j-atm"><rect class="j-atm-body j-paper" x="1110" y="300" width="120" height="170" rx="8"/><rect class="j-window" x="1130" y="320" width="80" height="50" rx="4"/><rect class="j-drawer" x="1130" y="390" width="80" height="12" rx="3"/>
      <g class="j-stop"><circle class="j-stop-bg" cx="1230" cy="300" r="26"/><text class="j-stop-text" x="1230" y="309" text-anchor="middle">停</text></g></g>`)}
    <rect class="j-lamp-post" x="230" y="250" width="8" height="220"/><path class="j-lamp-head j-paper" d="M210 250h48l-8-22h-32Z"/><ellipse class="j-streetglow" cx="234" cy="300" rx="70" ry="40"/>
  </g>`;
}

// ---------- 場景：第 1 段，查證桌 ----------
function zoneCheck(x) {
  return `<g transform="translate(${x} 0)">
    <rect class="j-wall j-paper alt" x="160" y="130" width="1280" height="${GROUND - 130}"/>
    <path class="j-awning" d="M140 130h1320l-30 46H170Z"/>
    <rect class="j-desk j-paper" x="600" y="360" width="660" height="20" rx="6"/><rect class="j-desk" x="630" y="380" width="14" height="90"/><rect class="j-desk" x="1216" y="380" width="14" height="90"/>
    <g><rect class="j-paper j-card" x="660" y="250" width="130" height="110" rx="6"/><rect class="j-ad" x="672" y="262" width="106" height="86"/><circle class="j-skin" cx="725" cy="296" r="18"/><rect class="j-ad-btn" x="690" y="328" width="70" height="10" rx="5"/></g>
    ${hit('official', '本人登錄的官方帳號', `<g class="j-official"><rect class="j-paper j-card" x="830" y="236" width="150" height="124" rx="8"/><circle class="j-skin" cx="905" cy="282" r="22"/><path class="j-shirt" d="M872 330c6-18 18-26 33-26s27 8 33 26Z"/>
      <circle class="j-badge" cx="958" cy="256" r="14"/><path class="j-badge-tick" d="M951 256l5 5 9-10"/><rect class="j-poster-line" x="850" y="338" width="110" height="8" rx="4"/></g>`)}
    ${hit('pledge', '本人的聲明：我不會做的事', `<g class="j-pledge"><rect class="j-paper j-note-card" x="1020" y="210" width="190" height="150" rx="6"/>
      <rect class="j-poster-line" x="1040" y="232" width="120" height="10" rx="5"/>
      <g class="j-x"><path d="M1042 268l14 14M1056 268l-14 14"/></g><rect class="j-poster-line" x="1068" y="270" width="110" height="8" rx="4"/>
      <g class="j-x"><path d="M1042 298l14 14M1056 298l-14 14"/></g><rect class="j-poster-line" x="1068" y="300" width="90" height="8" rx="4"/>
      <g class="j-x"><path d="M1042 328l14 14M1056 328l-14 14"/></g><rect class="j-poster-line" x="1068" y="330" width="100" height="8" rx="4"/></g>`)}
    ${hit('magnifier', '放大鏡：比對截圖裡的臉', `<g class="j-magnifier"><circle class="j-lens" cx="790" cy="230" r="38"/><path class="j-handle" d="M816 256l36 36"/></g>`)}
    <rect class="j-board-cork j-paper" x="250" y="200" width="250" height="150" rx="6"/><rect class="j-note" x="275" y="220" width="70" height="56" transform="rotate(-4 310 248)"/><rect class="j-note alt" x="370" y="226" width="100" height="70" transform="rotate(3 420 260)"/>
  </g>`;
}

// ---------- 場景：第 2 段，交給本人 ----------
function zoneHandOff(x) {
  return `<g transform="translate(${x} 0)">
    <path class="j-roof j-paper" d="M980 200 L1240 90 L1500 200 Z"/>
    <rect class="j-wall j-paper" x="1010" y="200" width="460" height="${GROUND - 200}"/>
    <rect class="j-window-frame j-paper" x="1060" y="250" width="150" height="120" rx="6"/><rect class="j-window j-recv" x="1072" y="262" width="126" height="96"/>
    <rect class="j-door-hole" x="1290" y="330" width="100" height="140"/>
    ${hit('mailbox', '郵筒：交給本人確認', `<g class="j-mailbox"><rect class="j-mail-body" x="700" y="330" width="90" height="140" rx="14"/><rect class="j-mail-slot" x="715" y="360" width="60" height="10" rx="5"/><rect class="j-mail-cap" x="690" y="318" width="110" height="20" rx="8"/></g>`)}
    <g class="j-letter"><rect class="j-paper j-letter-bg" x="-22" y="-15" width="44" height="30" rx="3"/><path class="j-letter-flap" d="M-22 -15 L0 3 L22 -15"/></g>
    ${hit('booth', '165 反詐騙專線', `<g class="j-booth"><rect class="j-booth-body j-paper" x="300" y="230" width="140" height="240" rx="10"/><rect class="j-window" x="318" y="270" width="104" height="120" rx="4"/>
      <rect class="j-station-band" x="300" y="230" width="140" height="34" rx="10"/><text class="j-booth-text" x="370" y="256" text-anchor="middle">165</text><rect class="j-phone" x="354" y="300" width="32" height="50" rx="6"/></g>`)}
    <path class="j-tree j-paper" d="M560 300 q-60-10-50-70 q10-60 70-60 q60 0 70 60 q10 60-50 70Z"/><rect class="j-trunk" x="574" y="296" width="12" height="174"/>
  </g>`;
}

export const VERIFY = {
  stages: ['看到', '查證', '交給本人'],
  label: '你在公車站看到可疑廣告，上傳截圖查證，再把結果交給本人確認',
  zones: [zoneBusStop, zoneCheck, zoneHandOff],
  say: {
    phonead: '名人推薦投資、邀你加群組？先別急著加，上傳截圖查一下。',
    atm: '不要因為廣告匯款、儲值或買虛擬貨幣。有疑問打 165。',
    magnifier: '系統只送出截圖裡的臉部特徵數值，比對是不是已登錄的本人。',
    official: '本人登錄的官方帳號才是真的。不在名單上的帳號都要小心。',
    pledge: '本人寫下「我不會做的事」。廣告做了這些事，就和本人的聲明不符。',
    booth: '165 是反詐騙諮詢專線，不確定時先打去問。',
  },
  show: {
    hit: 'mailbox',
    start: '交給本人確認後，下一位查到同一張圖的人會直接看到結果。',
    stop: '先停下來了。要交給本人，請用下方的按鈕送出。',
    steps: [[500, 'show-send', '', false], [2600, 'show-arrive', '', false], [5600]],
  },
};
