---
version: alpha
name: TraceBack
description: 尋影 TraceBack 的設計規範。一個幫「臉被盜用的人」留證據、幫「看到可疑代言的人」查證的工具。介面像一張安靜的證據桌：暖紙色的底、近黑的咖啡色字、只有一個鐵鏽橘的動作色；警示、提醒、安心各有自己的狀態色，不和動作色混用。語氣是陪伴，不是嚇人。

colors:
  canvas: "#f6eee3"
  surface: "#fffdf9"
  surface-soft: "#fdf9f3"
  tonal: "#f1e7da"
  tonal-hover: "#eadccb"
  ink: "#33291f"
  muted: "#6f6257"
  line: "#eadfcf"
  input-line: "#c9b59b"
  primary: "#bc4b24"
  primary-pressed: "#96391a"
  primary-soft: "#fce8dd"
  on-primary: "#fffaf5"
  focus: "#f0a985"
  danger: "#a32a22"
  danger-text: "#7a1d16"
  danger-soft: "#fbe9e6"
  danger-line: "#efbcb4"
  caution-bg: "#fff3d1"
  caution-line: "#e9b949"
  caution-text: "#6b4e00"
  safe: "#2a7556"
  safe-soft: "#e3f2ea"
  safe-line: "#a9d5bf"
  privacy-bg: "#e3f2ea"

typography:
  display:
    fontFamily: ui-rounded, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif
    fontSize: 26px
    fontWeight: 600
    lineHeight: 1.4
  heading:
    fontFamily: ui-rounded, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.5
  verdict:
    fontFamily: ui-rounded, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: ui-rounded, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.75
  body-mobile:
    fontSize: 16px
  lead:
    fontSize: 16px
    color: "{colors.muted}"
  note:
    fontSize: 14px
    color: "{colors.muted}"
  label:
    fontSize: 14px
    fontWeight: 400
    color: "{colors.muted}"
  figure:
    fontFeature: tabular-nums
  mono:
    fontFamily: ui-monospace, Menlo, monospace
    fontSize: 13.5px

rounded:
  sm: 8px
  md: 12px
  lg: 18px
  pill: 999px

spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
  3xl: 28px

components:
  page:
    backgroundColor: "{colors.canvas}"
    maxWidth: 820px
    padding: "0 {spacing.lg}"
  view-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md} {spacing.3xl} {spacing.3xl}"
    shadow: "0 1px 2px rgba(80,55,30,.05), 0 4px 12px rgba(80,55,30,.04)"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    padding: "{spacing.md} {spacing.2xl}"
    minHeight: 48px
    fontWeight: 600
  button-secondary:
    backgroundColor: "{colors.tonal}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "{spacing.md} {spacing.2xl}"
    minHeight: 48px
  button-small:
    minHeight: 36px
    padding: "{spacing.xs} {spacing.lg}"
  role-card:
    backgroundColor: "{colors.surface-soft}"
    borderColor: "{colors.line}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  text-input:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.input-line}"
    rounded: "{rounded.md}"
    minHeight: 46px
  drop-zone:
    borderColor: "{colors.line}"
    borderStyle: dashed
    rounded: "{rounded.lg}"
  verdict-danger:
    backgroundColor: "{colors.danger-soft}"
    borderColor: "{colors.danger-line}"
    textColor: "{colors.danger-text}"
  verdict-caution:
    backgroundColor: "{colors.caution-bg}"
    borderColor: "{colors.caution-line}"
  verdict-safe:
    backgroundColor: "{colors.safe-soft}"
    borderColor: "{colors.safe-line}"
  verdict-neutral:
    backgroundColor: "{colors.surface-soft}"
    borderColor: "{colors.line}"
  finding:
    backgroundColor: "{colors.tonal}"
    rounded: "{rounded.sm}"
  finding-alert:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-text}"
  finding-calm:
    backgroundColor: "{colors.safe-soft}"
  privacy-banner:
    backgroundColor: "{colors.privacy-bg}"
    textColor: "{colors.safe}"
    rounded: "{rounded.md}"
  pill:
    rounded: "{rounded.pill}"
    fontSize: 13px
---

## Overview

TraceBack 的使用者常在兩種情緒裡：臉被盜用的人很慌，看到可疑廣告的人在猶豫要不要匯款。所以介面要像一張安靜、整齊的證據桌，不像警報器，也不像科技產品的發表會。

- **暖紙色的底**（`{colors.canvas}`）配**微暖的白卡片**（`{colors.surface}`）。卡片和底色之間的色差就是層次，陰影只是一層很淡的輔助。
- **只有一個動作色**：鐵鏽橘 `{colors.primary}`。每個畫面只有一個填滿的主要按鈕，其他按鈕都是色調按鈕（`{colors.tonal}`），沒有框線。
- **狀態色和動作色分開**：冒用、與聲明不符用 `danger`；無法確認但值得注意用 `caution`；本人的官方帳號、本人授權、沒有發現用 `safe`。不拿鐵鏽橘表示「危險」，也不拿綠色表示「可以按」。
- **語氣是陪伴**：白話、短句，先講結論再講原因；永遠不說「安全」，只說「查不到不代表安全」。

這份規範的做法參考了 [awesome-design-md](https://github.com/voltagent/awesome-design-md) 裡金融類網站（Wise、Mercury、Stripe）建立信任感的方式：單一動作色、狀態色獨立、用色調代替框線、數字用等寬數字。沒有沿用它們的品牌色、字型或 logo。

## Colors

### 動作
- **鐵鏽橘** `{colors.primary}`：主要按鈕、連結、焦點外框的來源色。一個畫面只出現一次填滿的鐵鏽橘按鈕。
- **按下** `{colors.primary-pressed}`：主要按鈕的 hover 與按下。
- **淡鐵鏽** `{colors.primary-soft}`：首頁身分選項的圖示底、選取文字的底色。不拿來表示狀態。

### 表面
- **底色** `{colors.canvas}`：整頁的暖紙色。
- **卡片** `{colors.surface}`：主要內容卡、輸入框。微暖的白，不用純白。
- **次要表面** `{colors.surface-soft}`：卡片裡的區塊（存證紀錄、身分選項）。
- **色調** `{colors.tonal}`：次要按鈕、中性的資訊列。hover 是 `{colors.tonal-hover}`。

### 文字與線
- **字** `{colors.ink}`：近黑的咖啡色。
- **次要字** `{colors.muted}`：說明、標籤、時間。
- **線** `{colors.line}`：分隔線、卡片內框。
- **輸入框邊** `{colors.input-line}`：比一般線深一階，讓欄位一眼看得出來。

### 狀態
| 狀態 | 用在哪裡 | 色 |
|---|---|---|
| danger | 本人已確認冒用、與本人聲明不符、哪裡不符的理由、可能經過換臉、檔案標示為 AI 生成 | `{colors.danger-soft}` 底、`{colors.danger-line}` 框、`{colors.danger-text}` 字 |
| caution | 看起來是本人但無法確認、很可能來自你的照片 | `{colors.caution-bg}` 底、`{colors.caution-line}` 框 |
| safe | 本人的官方帳號、本人已確認授權、沒有發現的線索、隱私說明 | `{colors.safe-soft}` 底、`{colors.safe-line}` 框 |
| neutral | 查不到、不在登錄名單 | `{colors.surface-soft}` 底、`{colors.line}` 框 |

路徑一的「這張圖是從你的照片來的」也用 danger：對當事人來說，它代表照片被未經同意拿去用。「很可能是從你的照片來的」用 caution。新增結果時，先問它在說「危險」「值得注意」還是「沒有問題」，再選顏色。

## Typography

- **字型**：系統字（蘋果用 PingFang TC，其他用 Noto Sans TC 或微軟正黑體），不載入網路字型，第一次打開就快。
- **標題** 600，不用 800 以上的粗體；結果標題（verdict）700，因為那是使用者最需要一眼看到的一句話。
- **內文** 17px、行高 1.75，手機 16px。中文不加字距。
- **數字**：存證紀錄、比對數值表、分數、統計數字都用等寬數字（`tabular-nums`），對齊才好比。
- **雜湊與網址** 用等寬字（`{typography.mono}`），並允許在任何地方斷行。
- **標籤** 用內文字型、小一號、一般大小寫，不用全大寫、不加字距、不用等寬字。

## Layout

- 單欄，最寬 820px，置中；手機兩側留 16px。
- 間距一律是 4px 的倍數（`{spacing.*}`）。
- 每個步驟是一張卡片（`view-card`）：標題、一句說明、內容、最下方一列「上一步／下一步」，下一步在右邊。
- 首頁先問「你是哪一種情況」，只有兩個大選項；第二個選項展開後才有三個細項。不要再回到四張並列的卡片。
- 320px 寬度下每一頁都不能橫向捲動；`html`、`body` 用 `overflow-x: clip`。

## Elevation & Depth

| 層級 | 做法 | 用在哪裡 |
|---|---|---|
| 0 | 平的，靠底色區分 | 次要表面、色調按鈕、資訊列 |
| 1 | 卡片色 + 很淡的陰影 | 每個步驟的卡片、對話框、讀取中的提示 |
| hover | 陰影稍微加深 | 首頁的身分選項 |

不同時用細框和大陰影；不用側邊色條。

## Shapes

| 名稱 | 值 | 用在哪裡 |
|---|---|---|
| `{rounded.sm}` | 8px | 資訊列、小元件 |
| `{rounded.md}` | 12px | 輸入框、隱私說明、存證紀錄 |
| `{rounded.lg}` | 18px | 卡片、上傳區、身分選項、結果 |
| `{rounded.pill}` | 999px | 按鈕、狀態小標 |

選項右邊的箭頭是用框線畫出來的折角，不放「›」字元。

## Components

- **主要按鈕**（`button-primary`）：每個畫面一個，放在要使用者做的那件事上（下一步、查證、交給本人確認）。
- **次要按鈕**（`button-secondary`）：上一步、查證另一則、複製。色調底、沒有框線。
- **身分選項**（`role-card`）：整列可以點，左邊圖示、中間標題加一句說明、右邊折角。展開時邊框變鐵鏽橘、折角轉向下。
- **上傳區**（`drop-zone`）：虛線框，可以點、拖放或貼上。選好後變成實線並顯示縮圖。
- **結果**（`verdict-*`）：圖示 + 一句粗體結論 + 一到兩句說明。顏色依「狀態」選，見 Colors。
- **線索列**（`finding`）：一行粗體標題 + 一句說明。危險用 `finding-alert`，沒有發現用 `finding-calm`，其他用色調底。
- **隱私說明**（`privacy-banner`）：頁面頂端一句話，講清楚哪些東西會離開裝置、哪些不會。
- **進度條**：用 `transform: scaleX()` 動畫，不改寬度。

## Motion

- 只動 `transform` 和 `opacity`，轉場時間 150 到 240ms，用 ease-out。
- 按鈕按下時 `scale(0.97)`；身分選項 `scale(0.99)`。
- hover 效果只在有滑鼠的裝置上出現（`@media (hover: hover) and (pointer: fine)`）。
- 系統設定「減少動態」時，關掉所有轉場與按下的縮放。

## Voice & copy

- 第二人稱「你」，白話、短句。先講結論，再講原因。
- 結果是**轉述本人的確認或聲明**，不是系統下判斷，例如「與本人的聲明不符」，而不是「這是詐騙」。
- 永遠不說「安全」。查不到就說「查不到不代表安全」。
- 每個限制都要說出來（例如「需要登入的內容讀不到」），寫在使用者看得到的地方。
- 遇到不雅影像的情境，預覽一律模糊，並提供 113。
- 不用破折號；不用「賦能、無縫、一站式」這類詞。

## Do's and Don'ts

### Do
- 每個畫面只放一個鐵鏽橘的主要按鈕。
- 依「狀態」選結果的顏色：危險 danger、注意 caution、本人確認或沒有發現 safe。
- 顏色與字型都用 `:root` 的 token；新增顏色先加 token。
- 數字用等寬數字；雜湊和網址允許任意斷行。
- 新增頁面時，裝飾圖示加 `aria-hidden="true"`，每個可以按的東西都要有 `:focus-visible`。
- 改完樣式跑 Hallmark 的檢查：`node sloplint.mjs <頁面與 css> --scope app`，要 0 FAIL。

### Don't
- 不要拿鐵鏽橘表示危險，也不要拿綠色當按鈕。
- 不要同時放兩個填滿的主要按鈕。
- 不要用純白、側邊色條、細框加大陰影。
- 不要用全大寫或加字距的標籤，不要在標題裡只把一個詞換顏色。
- 不要寫「安全」「已驗證為真」這類系統無法保證的話。
- 不要用 `transition: all`，不要動 `width`、`height`、`top`、`left`。

## Responsive Behavior

| 寬度 | 變化 |
|---|---|
| 640px 以上 | 首頁有插圖；選項與表格正常排列 |
| 640px 以下 | 隱藏首頁插圖、標題縮小；帳號編輯列、收件匣、自己上傳的改造圖改成單欄 |
| 600px 以下 | 內文 16px，卡片內距縮小 |
| 320px | 每頁都不能橫向捲動 |

按鈕至少 48px 高（小按鈕 36px），手機上好按。

## Iteration Guide

1. 一次只改一個元件，改之前先讀這份規範。
2. 用 token 名稱（`{colors.danger}`、`{rounded.lg}`）描述要改的地方。
3. 改完在 1280px 與 320px 各看一次，並跑 Hallmark 的 `sloplint`。
4. 新增的狀態或元件，先補進這份規範的表格，再寫程式。
