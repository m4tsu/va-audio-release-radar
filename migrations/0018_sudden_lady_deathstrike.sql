ALTER TABLE `voice_actors` ADD `name_kana_checked_at` text;--> statement-breakpoint
-- かなを既に持っている声優は引き直す相手ではないので、引いた印を付ける。
-- 付けないと、移し替えで入った人が毎週の取得対象に並ぶ
-- 入れる値はこの移し替えの日付。`updated_at` は毎週の取り込みで動くので、
-- 「いつ引いたか」の意味に合わない (引き直す相手を日付で選べなくなる)
UPDATE `voice_actors` SET `name_kana_checked_at` = '2026-09-23T00:00:00.000Z'
WHERE `name_kana_checked_at` IS NULL
  AND EXISTS (
    SELECT 1 FROM `voice_actor_attributes`
    WHERE `voice_actor_attributes`.`voice_actor_id` = `voice_actors`.`id`
      AND `voice_actor_attributes`.`attribute` = 'nameKana'
  );
