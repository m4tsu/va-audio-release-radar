-- E2E 用の固定データ。`npm run db:seed:e2e` で E2E 専用の D1 に流す (開発用の .wrangler/state ではない)。
--
-- 実データと混ざっても壊れないように、ID・slug・名前をすべて "e2e" / "テスト" で始める。
-- 何度流しても同じ状態になるよう INSERT OR REPLACE を使い、自動採番の列にも明示の ID を振る。
--
-- 日付は `date('now', ...)` で毎回ずらす。固定日を書くと、時間が経つほど
-- 「直近 30 日の新着」から外れてテストが落ちるため。

-- 声優 4 人 ----------------------------------------------------------------
-- ガンマは作品を 1 件も持たない。DB には居るが表には出ないことの確認用 (T13)
-- デルタは名前順ではアルファより後ろだが作品数はいちばん多い。
-- 一覧の「作品数の多い順」が名前順と違う並びになることの確認用
INSERT OR REPLACE INTO voice_actors
  (id, slug, canonical_name, name_kana, anilist_staff_id, image_url, status, created_at, updated_at)
VALUES
  ('va_e2e-alpha', 'e2e-alpha', 'テスト声優アルファ', 'てすとせいゆうあるふぁ', NULL, NULL, 'active',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('va_e2e-beta', 'e2e-beta', 'テスト声優ベータ', 'てすとせいゆうべーた', NULL, NULL, 'active',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('va_e2e-gamma', 'e2e-gamma', 'テスト声優ガンマ', 'てすとせいゆうがんま', NULL, NULL, 'active',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('va_e2e-delta', 'e2e-delta', 'テスト声優デルタ', 'てすとせいゆうでるた', NULL, NULL, 'active',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR REPLACE INTO voice_actor_aliases (id, voice_actor_id, name, source, verified)
VALUES (9000001, 'va_e2e-alpha', 'テスト 声優アルファ', 'manual', 1);

-- 作品 4 件 ----------------------------------------------------------------
-- 4 件目は発売日が未来。フィードの「今後の発売」の段が出ることの確認用
INSERT OR REPLACE INTO audio_works
  (id, title, category, release_date, cover_image_url, duration_seconds, age_rating, maker_name, created_at, updated_at)
VALUES
  ('dlsite:RJ90000001', 'テスト用ASMR作品アルファ', 'asmr', date('now', '-2 day'), NULL, 5160, 'general', 'テストサークル',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('audible:B0E2E00002', 'テスト用朗読作品アルファ', 'audiobook', date('now', '-5 day'), NULL, 29520, 'unknown', 'テスト出版',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('dlsite:RJ90000003', 'テスト用ボイスドラマ作品ベータ', 'audio_drama', date('now', '-10 day'), NULL, 3600, 'general', 'テストサークル',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('dlsite:RJ90000004', 'テスト用発売予定作品アルファ', 'asmr', date('now', '+14 day'), NULL, 4200, 'general', 'テストサークル',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

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
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (9000004, 'dlsite:RJ90000004', 'dlsite', 'RJ90000004',
   'https://www.dlsite.com/home/work/=/product_id/RJ90000004.html', NULL,
   'テスト用発売予定作品アルファ', 1320, NULL, 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- クレジット --------------------------------------------------------------
-- 4 件目は名寄せできていない表記。管理画面の未解決キューに出る。
-- デルタは 4 件すべてに出演させ、アルファ (3 件) より作品数を多くする
INSERT OR REPLACE INTO audio_credits
  (id, audio_work_id, voice_actor_id, credited_name, role, confidence, source_store_slug)
VALUES
  (9000001, 'dlsite:RJ90000001', 'va_e2e-alpha', 'テスト声優アルファ', NULL, 'verified', 'dlsite'),
  (9000002, 'audible:B0E2E00002', 'va_e2e-alpha', 'テスト 声優アルファ', 'ナレーター', 'verified', 'audible'),
  (9000003, 'dlsite:RJ90000003', 'va_e2e-beta', 'テスト声優ベータ', NULL, 'verified', 'dlsite'),
  (9000004, 'dlsite:RJ90000001', NULL, 'テスト未解決表記', NULL, 'unmatched', 'dlsite'),
  (9000005, 'dlsite:RJ90000004', 'va_e2e-alpha', 'テスト声優アルファ', NULL, 'verified', 'dlsite'),
  (9000006, 'dlsite:RJ90000001', 'va_e2e-delta', 'テスト声優デルタ', NULL, 'verified', 'dlsite'),
  (9000007, 'audible:B0E2E00002', 'va_e2e-delta', 'テスト声優デルタ', NULL, 'verified', 'audible'),
  (9000008, 'dlsite:RJ90000003', 'va_e2e-delta', 'テスト声優デルタ', NULL, 'verified', 'dlsite'),
  (9000009, 'dlsite:RJ90000004', 'va_e2e-delta', 'テスト声優デルタ', NULL, 'verified', 'dlsite');

-- クロール履歴 ------------------------------------------------------------
-- audible × アルファ は「前回 12 件 → 今回 0 件」で警告、dlsite × ベータ は失敗で警告になる
-- total_count / coverage_complete は網羅率 (設計書 §13)。
-- dlsite-alpha-2 は取り切れていない run (30/48) として置き、管理画面の「網羅」列を確かめる
INSERT OR REPLACE INTO crawl_runs
  (id, store_slug, voice_actor_id, started_at, finished_at, work_count, new_count, status, error,
   total_count, coverage_complete)
VALUES
  ('e2e-run-dlsite-alpha-2', 'dlsite', 'va_e2e-alpha',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hour'),
   30, 2, 'ok', NULL, 48, 0),
  ('e2e-run-dlsite-alpha-1', 'dlsite', 'va_e2e-alpha',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'),
   28, 1, 'ok', NULL, 28, 1),
  ('e2e-run-audible-alpha-2', 'audible', 'va_e2e-alpha',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hour'),
   0, 0, 'ok', NULL, NULL, NULL),
  ('e2e-run-audible-alpha-1', 'audible', 'va_e2e-alpha',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'),
   12, 0, 'ok', NULL, 12, 1),
  ('e2e-run-dlsite-beta-1', 'dlsite', 'va_e2e-beta',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 hour'),
   0, 0, 'error', 'E2E 用の失敗記録', NULL, NULL);

-- アニメ 1 本 --------------------------------------------------------------
-- アニメからの導線 (/anime → 最新シーズン → 作品ページ) の確認用。
-- 出演者はアルファ (音声作品あり) とガンマ (音声作品なし) の 2 人。
-- 一覧にも作品ページにも出るのは音声作品がある人だけなので、ガンマは出ない
INSERT OR REPLACE INTO anime_titles
  (id, slug, title_native, title_romaji, title_english, season_year, season, cover_image_url, created_at, updated_at)
VALUES
  ('anilist:9000001', 'e2e-anime-alpha', 'テストアニメアルファ', 'Test Anime Alpha', 'Test Anime Alpha',
   2026, 'FALL', NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 day'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR REPLACE INTO anime_appearances
  (id, anime_title_id, voice_actor_id, character_id, character_name_native, character_name_full,
   character_image_url, role)
VALUES
  (9000001, 'anilist:9000001', 'va_e2e-alpha', 'anilist:9100001', 'テストキャラアルファ', NULL, NULL, 'main'),
  (9000002, 'anilist:9000001', 'va_e2e-gamma', 'anilist:9100002', 'テストキャラガンマ', NULL, NULL, 'supporting');
