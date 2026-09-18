-- E2E 用の固定データ。`npm run db:seed:e2e` でローカル D1 に流す。
--
-- 実データと混ざっても壊れないように、ID・slug・名前をすべて "e2e" / "テスト" で始める。
-- 何度流しても同じ状態になるよう INSERT OR REPLACE を使い、自動採番の列にも明示の ID を振る。
--
-- 日付は `date('now', ...)` で毎回ずらす。固定日を書くと、時間が経つほど
-- 「直近 30 日の新着」から外れてテストが落ちるため。

-- 声優 2 人 ----------------------------------------------------------------
INSERT OR REPLACE INTO voice_actors
  (id, slug, canonical_name, name_kana, anilist_staff_id, image_url, status, created_at, updated_at)
VALUES
  ('va_e2e-alpha', 'e2e-alpha', 'テスト声優アルファ', 'てすとせいゆうあるふぁ', NULL, NULL, 'active',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('va_e2e-beta', 'e2e-beta', 'テスト声優ベータ', 'てすとせいゆうべーた', NULL, NULL, 'active',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR REPLACE INTO voice_actor_aliases (id, voice_actor_id, name, source, verified)
VALUES (9000001, 'va_e2e-alpha', 'テスト 声優アルファ', 'manual', 1);

-- 作品 3 件 ----------------------------------------------------------------
INSERT OR REPLACE INTO audio_works
  (id, title, category, release_date, cover_image_url, duration_seconds, adult, maker_name, created_at, updated_at)
VALUES
  ('dlsite:RJ90000001', 'テスト用ASMR作品アルファ', 'asmr', date('now', '-2 day'), NULL, 5160, 0, 'テストサークル',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('audible:B0E2E00002', 'テスト用朗読作品アルファ', 'audiobook', date('now', '-5 day'), NULL, 29520, 0, 'テスト出版',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('dlsite:RJ90000003', 'テスト用ボイスドラマ作品ベータ', 'audio_drama', date('now', '-10 day'), NULL, 3600, 0, 'テストサークル',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ストアの掲載 ------------------------------------------------------------
-- 1 件目だけアフィリエイト URL を持たせる (StoreLink がそちらを優先することの確認用)
INSERT OR REPLACE INTO store_listings
  (id, audio_work_id, store_slug, store_product_id, product_url, affiliate_url, title_raw,
   price, list_price, available, first_seen_at, last_seen_at, last_checked_at)
VALUES
  (9000001, 'dlsite:RJ90000001', 'dlsite', 'RJ90000001',
   'https://www.dlsite.com/home/work/=/product_id/RJ90000001.html',
   'https://www.dlsite.com/home/dlaf/=/link/work/aid/e2etest/id/RJ90000001.html',
   'テスト用ASMR作品アルファ', 1584, 1980, 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (9000002, 'audible:B0E2E00002', 'audible', 'B0E2E00002',
   'https://www.audible.co.jp/pd/B0E2E00002', NULL,
   'テスト用朗読作品アルファ', 2690, NULL, 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (9000003, 'dlsite:RJ90000003', 'dlsite', 'RJ90000003',
   'https://www.dlsite.com/home/work/=/product_id/RJ90000003.html', NULL,
   'テスト用ボイスドラマ作品ベータ', 1100, NULL, 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- クレジット --------------------------------------------------------------
-- 最後の 1 件は名寄せできていない表記。管理画面の未解決キューに出る
INSERT OR REPLACE INTO audio_credits
  (id, audio_work_id, voice_actor_id, credited_name, role, confidence, source_store_slug)
VALUES
  (9000001, 'dlsite:RJ90000001', 'va_e2e-alpha', 'テスト声優アルファ', NULL, 'verified', 'dlsite'),
  (9000002, 'audible:B0E2E00002', 'va_e2e-alpha', 'テスト 声優アルファ', 'ナレーター', 'verified', 'audible'),
  (9000003, 'dlsite:RJ90000003', 'va_e2e-beta', 'テスト声優ベータ', NULL, 'verified', 'dlsite'),
  (9000004, 'dlsite:RJ90000001', NULL, 'テスト未解決表記', NULL, 'unmatched', 'dlsite');

-- クロール履歴 ------------------------------------------------------------
-- audible × アルファ は「前回 12 件 → 今回 0 件」で警告、dlsite × ベータ は失敗で警告になる
INSERT OR REPLACE INTO crawl_runs
  (id, store_slug, voice_actor_id, started_at, finished_at, work_count, new_count, status, error)
VALUES
  ('e2e-run-dlsite-alpha-2', 'dlsite', 'va_e2e-alpha',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hour'),
   30, 2, 'ok', NULL),
  ('e2e-run-dlsite-alpha-1', 'dlsite', 'va_e2e-alpha',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'),
   28, 1, 'ok', NULL),
  ('e2e-run-audible-alpha-2', 'audible', 'va_e2e-alpha',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hour'),
   0, 0, 'ok', NULL),
  ('e2e-run-audible-alpha-1', 'audible', 'va_e2e-alpha',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'),
   12, 0, 'ok', NULL),
  ('e2e-run-dlsite-beta-1', 'dlsite', 'va_e2e-beta',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 hour'),
   0, 0, 'error', 'E2E 用の失敗記録');
