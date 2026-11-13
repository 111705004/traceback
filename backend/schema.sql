-- 尋影 TraceBack 資料庫結構（Cloudflare D1，也就是 SQLite）
-- 重複執行不會清掉資料。

-- 登錄的當事人（KOL、專業人士）
CREATE TABLE IF NOT EXISTS kols (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  statement TEXT NOT NULL DEFAULT '{}',   -- 本人聲明，JSON：{ never: [...], note: '' }
  status TEXT NOT NULL DEFAULT 'pending', -- pending 待審核、approved 公開查證中、rejected 未通過
  token_hash TEXT NOT NULL,               -- 管理連結的 SHA-256，原文只在登錄時給一次
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 臉部特徵：128 維數值，不存照片
CREATE TABLE IF NOT EXISTS kol_faces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kol_id TEXT NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'full', -- full 完整的臉、inner 只有五官、outer 只有臉型（換臉檢查用）
  descriptor TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kol_faces_kol ON kol_faces(kol_id);

-- 本人聲明的官方帳號
CREATE TABLE IF NOT EXISTS kol_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kol_id TEXT NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,       -- 正規化後的帳號，比對用
  label TEXT NOT NULL,        -- 使用者輸入的原樣，顯示用
  url TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL,         -- 帳號歸屬驗證碼，要貼在帳號簡介
  verified INTEGER NOT NULL DEFAULT 0, -- 0 未驗證、1 已驗證
  verified_by TEXT NOT NULL DEFAULT ''  -- auto 自動讀到驗證碼、admin 人工確認
);
CREATE INDEX IF NOT EXISTS kol_accounts_kol ON kol_accounts(kol_id);
CREATE INDEX IF NOT EXISTS kol_accounts_handle ON kol_accounts(platform, handle);

-- 民眾回報的可疑內容
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  kol_id TEXT NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
  phash TEXT NOT NULL,          -- 16 位十六進位的感知雜湊，用來認出同一張圖
  sha256 TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '', -- 縮小後的截圖（data URL），只在民眾同意時保存，到期清除
  source_url TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL DEFAULT '',
  activities TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', -- pending 待本人確認、fake 本人確認冒用、authorized 本人確認授權、dismissed 不相關
  kol_note TEXT NOT NULL DEFAULT '',      -- 本人的公開說明
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS reports_kol ON reports(kol_id, status);

-- 簡易的流量限制
CREATE TABLE IF NOT EXISTS rate (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window INTEGER NOT NULL
);
