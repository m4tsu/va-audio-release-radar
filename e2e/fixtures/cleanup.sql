-- `e2e/fixtures/seed.sql` が入れた行だけを消す。`npm run db:seed:e2e:clean` から実行する。
--
-- 実データを巻き込まないよう、すべて seed.sql で明示した ID を指定した DELETE にする
-- (WHERE 句を名前の LIKE 等にしない。将来実データが同じ名前を持つ可能性を排除できないため)。
-- FK 制約があるので子 (credits/listings) → 親 (works/aliases/actors) の順に消す。
-- crawl_runs は他テーブルから参照されないので順不同でよい。

DELETE FROM audio_credits WHERE id IN (9000001, 9000002, 9000003, 9000004);

DELETE FROM store_listings WHERE id IN (9000001, 9000002, 9000003);

DELETE FROM audio_works WHERE id IN ('dlsite:RJ90000001', 'audible:B0E2E00002', 'dlsite:RJ90000003');

DELETE FROM voice_actor_aliases WHERE id IN (9000001);

DELETE FROM voice_actors WHERE id IN ('va_e2e-alpha', 'va_e2e-beta');

DELETE FROM crawl_runs WHERE id IN (
  'e2e-run-dlsite-alpha-2',
  'e2e-run-dlsite-alpha-1',
  'e2e-run-audible-alpha-2',
  'e2e-run-audible-alpha-1',
  'e2e-run-dlsite-beta-1'
);
