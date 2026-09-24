-- 作品の出演者数 (`audio_works.cast_size`) を埋め、トリガーで保つ。
--
-- 画面は出演者数だけで出演形態を決める。表示のたびに credit を数えると、新着 1 回で並べる作品の
-- credit を全部読む。数えた値を作品の行に持たせ、読む側は列を読むだけにする。
--
-- 数え方: 名寄せ済みの credit は声優 ID で、未解決の credit は表記そのもので 1 人とみなし、
-- 重複を除いて数える。`src/server/queries/works.ts` の `WorkWithListings` の `castSize` と同じ。どちらかを変えるときは両方を変える。
--
-- アプリの書き込み経路ではなくトリガーで保つ理由と、行を入れる順によらず値が揃う作りは
-- `0020_on_sale_counts_triggers.sql` と同じ。値が変わらない更新 (取り込みのたびの credit の upsert) では
-- WHEN で発火させない。

UPDATE `audio_works` SET `cast_size` = (
  SELECT count(DISTINCT coalesce('actor:' || `ac`.`voice_actor_id`, 'name:' || `ac`.`credited_name`))
  FROM `audio_credits` `ac` WHERE `ac`.`audio_work_id` = `audio_works`.`id`
);
--> statement-breakpoint
-- クエリ結果のキャッシュの世代 (`src/server/data-cache.ts`)。行が 1 つあることを前提に読むので最初に入れる
INSERT INTO `data_generation` (`id`, `generation`, `updated_at`)
VALUES (1, 'initial', '2026-09-24T00:00:00.000Z')
ON CONFLICT (`id`) DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER `audio_credits_cast_size_ai` AFTER INSERT ON `audio_credits`
BEGIN
  UPDATE `audio_works` SET `cast_size` = (
    SELECT count(DISTINCT coalesce('actor:' || `ac`.`voice_actor_id`, 'name:' || `ac`.`credited_name`))
    FROM `audio_credits` `ac` WHERE `ac`.`audio_work_id` = `audio_works`.`id`
  )
  WHERE `id` = NEW.`audio_work_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `audio_credits_cast_size_ad` AFTER DELETE ON `audio_credits`
BEGIN
  UPDATE `audio_works` SET `cast_size` = (
    SELECT count(DISTINCT coalesce('actor:' || `ac`.`voice_actor_id`, 'name:' || `ac`.`credited_name`))
    FROM `audio_credits` `ac` WHERE `ac`.`audio_work_id` = `audio_works`.`id`
  )
  WHERE `id` = OLD.`audio_work_id`;
END;
--> statement-breakpoint
-- 取り込みの upsert は値が同じでも credit の列を SET に載せる。`UPDATE OF` は SET に列があれば発火するので、
-- 値が変わったときだけに絞る。名寄せで 2 つの表記が同じ声優に解決されると数が減るので、声優 ID の変化では数え直す
CREATE TRIGGER `audio_credits_cast_size_au` AFTER UPDATE OF `audio_work_id`, `voice_actor_id`, `credited_name` ON `audio_credits`
WHEN OLD.`audio_work_id` IS NOT NEW.`audio_work_id`
  OR OLD.`voice_actor_id` IS NOT NEW.`voice_actor_id`
  OR OLD.`credited_name` IS NOT NEW.`credited_name`
BEGIN
  UPDATE `audio_works` SET `cast_size` = (
    SELECT count(DISTINCT coalesce('actor:' || `ac`.`voice_actor_id`, 'name:' || `ac`.`credited_name`))
    FROM `audio_credits` `ac` WHERE `ac`.`audio_work_id` = `audio_works`.`id`
  )
  WHERE `id` IN (OLD.`audio_work_id`, NEW.`audio_work_id`);
END;
--> statement-breakpoint
-- 作品の行が credit より後に入る流し込みでも値が揃うようにする
CREATE TRIGGER `audio_works_cast_size_ai` AFTER INSERT ON `audio_works`
BEGIN
  UPDATE `audio_works` SET `cast_size` = (
    SELECT count(DISTINCT coalesce('actor:' || `ac`.`voice_actor_id`, 'name:' || `ac`.`credited_name`))
    FROM `audio_credits` `ac` WHERE `ac`.`audio_work_id` = `audio_works`.`id`
  )
  WHERE `id` = NEW.`id`;
END;
