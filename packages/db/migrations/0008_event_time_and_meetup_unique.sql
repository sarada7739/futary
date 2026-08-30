-- 部分UNIQUEインデックスを張る前に、既存の重複（同じcouple_id・dateのmeetupが
-- 複数件）を潰す。残すのは最新の1件（created_atが最大、同値ならidが大きい方）。
-- 新しい挙動（後で登録したもので上書き）と揃える（018・architecture.md 5節）
DELETE FROM `events`
 WHERE `kind` = 'meetup'
   AND `id` NOT IN (
     SELECT `id` FROM (
       SELECT `id`,
              ROW_NUMBER() OVER (
                PARTITION BY `couple_id`, `date`
                ORDER BY `created_at` DESC, `id` DESC
              ) AS rn
         FROM `events`
        WHERE `kind` = 'meetup'
     )
     WHERE rn = 1
   );
--> statement-breakpoint
ALTER TABLE `events` ADD `time` text;--> statement-breakpoint
CREATE UNIQUE INDEX `events_meetup_unique` ON `events` (`couple_id`,`date`) WHERE "events"."kind" = 'meetup';
