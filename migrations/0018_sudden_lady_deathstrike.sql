ALTER TABLE `voice_actors` ADD `name_kana_checked_at` text;--> statement-breakpoint
-- かなを既に持っている声優は引き直す相手ではないので、引いた印を付ける。
-- 付けないと、移し替えで入った人が毎週の取得対象に並ぶ
UPDATE `voice_actors` SET `name_kana_checked_at` = `updated_at`
WHERE `name_kana_checked_at` IS NULL
  AND EXISTS (
    SELECT 1 FROM `voice_actor_attributes`
    WHERE `voice_actor_attributes`.`voice_actor_id` = `voice_actors`.`id`
      AND `voice_actor_attributes`.`attribute` = 'nameKana'
  );
