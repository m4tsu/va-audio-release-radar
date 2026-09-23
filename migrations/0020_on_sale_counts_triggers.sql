-- 「買える作品の数」を声優とアニメの行に持たせ、トリガーで保つ。
--
-- 一覧・検索・シーズンの索引は、声優やアニメを選ぶ条件に「買える作品を持つか」を使う。
-- これを credit → 作品 → listing と辿って確かめると、出演の全行・声優の全行について作品を読むので、
-- 数えた結果を行に持たせ、読む側は 1 行ずつ見るだけにする。
--
-- アプリの書き込み経路ではなくトリガーで保つのは、credit・listing・作品・出演を書き換える経路が
-- ingest・AniList の取り込み・管理画面・手で流す SQL と複数あり、どれか 1 つが数え直しを忘れると
-- 一覧から作品が消えたり、開くと 404 になる声優が並んだりするため。
-- 「買える」の条件 (R18 でなく、取り下げていない listing がある) は `src/server/queries/works.ts` の
-- `notAdultRated` / `onSaleSomewhere` と同じ。どちらかを変えるときは両方を変える。
--
-- 数え直しは影響を受けた声優・アニメの行だけに絞る。値が変わらない更新 (取り込みのたびの
-- last_seen_at の書き換えなど) では WHEN で発火させない。
-- 数え直しが参照する 5 つの表 (声優・作品・listing・credit・出演) とアニメのどれに行を足しても数え直すので、
-- 表を丸ごと流し込むとき (`npm run db:restore:local`) も、入れる順によらず最後に入れた行で値が揃う。

-- 既存の行を数える。トリガーより先に流すのは、声優の値が変わるたびにアニメの数え直しが走らないようにするため
UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
  SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
  FROM `audio_credits` `ac`
  JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
  JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
  WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
);
--> statement-breakpoint
UPDATE `anime_titles` SET `on_sale_actor_count` = (
  SELECT count(DISTINCT `aa`.`voice_actor_id`) FROM `anime_appearances` `aa`
  JOIN `voice_actors` `va` ON `va`.`id` = `aa`.`voice_actor_id`
  WHERE `aa`.`anime_title_id` = `anime_titles`.`id` AND `va`.`on_sale_work_count` > 0
);
--> statement-breakpoint

-- 声優の数え直し。対象の声優を選ぶ部分だけがトリガーごとに違う
CREATE TRIGGER `audio_credits_on_sale_ai` AFTER INSERT ON `audio_credits`
WHEN NEW.`voice_actor_id` IS NOT NULL
BEGIN
  UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
    SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
    FROM `audio_credits` `ac`
    JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
    JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
    WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
  )
  WHERE `id` = NEW.`voice_actor_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `audio_credits_on_sale_ad` AFTER DELETE ON `audio_credits`
WHEN OLD.`voice_actor_id` IS NOT NULL
BEGIN
  UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
    SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
    FROM `audio_credits` `ac`
    JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
    JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
    WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
  )
  WHERE `id` = OLD.`voice_actor_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `audio_credits_on_sale_au` AFTER UPDATE OF `voice_actor_id`, `audio_work_id` ON `audio_credits`
WHEN OLD.`voice_actor_id` IS NOT NEW.`voice_actor_id` OR OLD.`audio_work_id` IS NOT NEW.`audio_work_id`
BEGIN
  UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
    SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
    FROM `audio_credits` `ac`
    JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
    JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
    WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
  )
  WHERE `id` IN (OLD.`voice_actor_id`, NEW.`voice_actor_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `store_listings_on_sale_ai` AFTER INSERT ON `store_listings`
WHEN NEW.`delisted_at` IS NULL
BEGIN
  UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
    SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
    FROM `audio_credits` `ac`
    JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
    JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
    WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
  )
  WHERE `id` IN (SELECT `voice_actor_id` FROM `audio_credits` WHERE `audio_work_id` = NEW.`audio_work_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `store_listings_on_sale_ad` AFTER DELETE ON `store_listings`
WHEN OLD.`delisted_at` IS NULL
BEGIN
  UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
    SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
    FROM `audio_credits` `ac`
    JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
    JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
    WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
  )
  WHERE `id` IN (SELECT `voice_actor_id` FROM `audio_credits` WHERE `audio_work_id` = OLD.`audio_work_id`);
END;
--> statement-breakpoint
-- 取り下げの日時が別の日時に書き換わるだけなら買えるかどうかは変わらないので、NULL かどうかで比べる
CREATE TRIGGER `store_listings_on_sale_au` AFTER UPDATE OF `delisted_at`, `audio_work_id`, `store_slug` ON `store_listings`
WHEN (OLD.`delisted_at` IS NULL) IS NOT (NEW.`delisted_at` IS NULL)
  OR OLD.`audio_work_id` IS NOT NEW.`audio_work_id`
  OR OLD.`store_slug` IS NOT NEW.`store_slug`
BEGIN
  UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
    SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
    FROM `audio_credits` `ac`
    JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
    JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
    WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
  )
  WHERE `id` IN (
    SELECT `voice_actor_id` FROM `audio_credits`
    WHERE `audio_work_id` IN (OLD.`audio_work_id`, NEW.`audio_work_id`)
  );
END;
--> statement-breakpoint
CREATE TRIGGER `audio_works_on_sale_au` AFTER UPDATE OF `age_rating` ON `audio_works`
WHEN (OLD.`age_rating` = 'r18') IS NOT (NEW.`age_rating` = 'r18')
BEGIN
  UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
    SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
    FROM `audio_credits` `ac`
    JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
    JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
    WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
  )
  WHERE `id` IN (SELECT `voice_actor_id` FROM `audio_credits` WHERE `audio_work_id` = NEW.`id`);
END;
--> statement-breakpoint
-- 作品の行は credit と listing より先に入るのが普通だが、流し込みの順が逆でも値が揃うようにする
CREATE TRIGGER `audio_works_on_sale_ai` AFTER INSERT ON `audio_works`
BEGIN
  UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
    SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
    FROM `audio_credits` `ac`
    JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
    JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
    WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
  )
  WHERE `id` IN (SELECT `voice_actor_id` FROM `audio_credits` WHERE `audio_work_id` = NEW.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `voice_actors_on_sale_ai` AFTER INSERT ON `voice_actors`
BEGIN
  UPDATE `voice_actors` SET (`on_sale_work_count`, `on_sale_store_slugs`) = (
    SELECT count(DISTINCT `ac`.`audio_work_id`), group_concat(DISTINCT `sl`.`store_slug`)
    FROM `audio_credits` `ac`
    JOIN `audio_works` `w` ON `w`.`id` = `ac`.`audio_work_id` AND `w`.`age_rating` <> 'r18'
    JOIN `store_listings` `sl` ON `sl`.`audio_work_id` = `ac`.`audio_work_id` AND `sl`.`delisted_at` IS NULL
    WHERE `ac`.`voice_actor_id` = `voice_actors`.`id`
  )
  WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint

-- アニメの数え直し。声優の値が 0 と 1 以上のあいだで動いたときと、出演の行が変わったとき
CREATE TRIGGER `voice_actors_on_sale_au` AFTER UPDATE OF `on_sale_work_count` ON `voice_actors`
WHEN (OLD.`on_sale_work_count` > 0) IS NOT (NEW.`on_sale_work_count` > 0)
BEGIN
  UPDATE `anime_titles` SET `on_sale_actor_count` = (
    SELECT count(DISTINCT `aa`.`voice_actor_id`) FROM `anime_appearances` `aa`
    JOIN `voice_actors` `va` ON `va`.`id` = `aa`.`voice_actor_id`
    WHERE `aa`.`anime_title_id` = `anime_titles`.`id` AND `va`.`on_sale_work_count` > 0
  )
  WHERE `id` IN (SELECT `anime_title_id` FROM `anime_appearances` WHERE `voice_actor_id` = NEW.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `anime_appearances_on_sale_ai` AFTER INSERT ON `anime_appearances`
BEGIN
  UPDATE `anime_titles` SET `on_sale_actor_count` = (
    SELECT count(DISTINCT `aa`.`voice_actor_id`) FROM `anime_appearances` `aa`
    JOIN `voice_actors` `va` ON `va`.`id` = `aa`.`voice_actor_id`
    WHERE `aa`.`anime_title_id` = `anime_titles`.`id` AND `va`.`on_sale_work_count` > 0
  )
  WHERE `id` = NEW.`anime_title_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `anime_appearances_on_sale_ad` AFTER DELETE ON `anime_appearances`
BEGIN
  UPDATE `anime_titles` SET `on_sale_actor_count` = (
    SELECT count(DISTINCT `aa`.`voice_actor_id`) FROM `anime_appearances` `aa`
    JOIN `voice_actors` `va` ON `va`.`id` = `aa`.`voice_actor_id`
    WHERE `aa`.`anime_title_id` = `anime_titles`.`id` AND `va`.`on_sale_work_count` > 0
  )
  WHERE `id` = OLD.`anime_title_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `anime_appearances_on_sale_au` AFTER UPDATE OF `anime_title_id`, `voice_actor_id` ON `anime_appearances`
WHEN OLD.`anime_title_id` IS NOT NEW.`anime_title_id` OR OLD.`voice_actor_id` IS NOT NEW.`voice_actor_id`
BEGIN
  UPDATE `anime_titles` SET `on_sale_actor_count` = (
    SELECT count(DISTINCT `aa`.`voice_actor_id`) FROM `anime_appearances` `aa`
    JOIN `voice_actors` `va` ON `va`.`id` = `aa`.`voice_actor_id`
    WHERE `aa`.`anime_title_id` = `anime_titles`.`id` AND `va`.`on_sale_work_count` > 0
  )
  WHERE `id` IN (OLD.`anime_title_id`, NEW.`anime_title_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `anime_titles_on_sale_ai` AFTER INSERT ON `anime_titles`
BEGIN
  UPDATE `anime_titles` SET `on_sale_actor_count` = (
    SELECT count(DISTINCT `aa`.`voice_actor_id`) FROM `anime_appearances` `aa`
    JOIN `voice_actors` `va` ON `va`.`id` = `aa`.`voice_actor_id`
    WHERE `aa`.`anime_title_id` = `anime_titles`.`id` AND `va`.`on_sale_work_count` > 0
  )
  WHERE `id` = NEW.`id`;
END;
