CREATE TABLE `post_images` (
	`post_id` text NOT NULL,
	`position` integer NOT NULL,
	`key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	PRIMARY KEY(`post_id`, `position`),
	CONSTRAINT "post_images_position_range_check" CHECK("post_images"."position" BETWEEN 0 AND 3),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `post_images_key_unique` ON `post_images` (`key`);--> statement-breakpoint
-- 論理削除済みの投稿の画像は移さない（security-auditor指摘）。旧設計（007）は
-- 論理削除後もimage_keyを残していたため、削除済みの投稿がここでpost_images行を
-- 持ってしまうと、031の新しい不変条件（post_imagesは論理削除を持たない。
-- post.deleteが物理削除する）と矛盾する状態を移行直後から作ってしまう。
-- 対象の画像は移行後に列ごと落ちるためR2上で孤児になるが、それはpost.delete
-- 導入前の007設計が元々許容していた状態（architecture.md 6節）と同じであり、
-- 悪化ではない
INSERT INTO `post_images` (`post_id`, `position`, `key`, `width`, `height`)
  SELECT `id`, 0, `image_key`, `image_width`, `image_height`
    FROM `posts` WHERE `image_key` IS NOT NULL AND `deleted_at` IS NULL;--> statement-breakpoint
DROP INDEX `posts_image_key_unique`;--> statement-breakpoint
ALTER TABLE `posts` DROP COLUMN `image_key`;--> statement-breakpoint
ALTER TABLE `posts` DROP COLUMN `image_width`;--> statement-breakpoint
ALTER TABLE `posts` DROP COLUMN `image_height`;
