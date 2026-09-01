-- invite_failuresは1時間の時間窓で自然に切れる一時的なレート制限記録
-- （読み方はpackages/db/src/schema/couple.tsのinviteFailuresコメント参照）。
-- 既存行にaccount_hashを遡って計算する手段が無い（HMACの鍵〈BETTER_AUTH_SECRET〉
-- も元のGoogleアカウントIDもマイグレーションSQLからは扱えない）ため、
-- NOT NULL列を追加できるようにする前に空にする。実害は「デプロイ直後の
-- 短い期間、レート制限のカウントが一度だけ0に戻る」だけで、悪用しても
-- 得られるのはコード1つぶんの追加試行10回程度（4節の閾値）。
--
-- 【architecture.md 4節「行を消すマイグレーションは、当てる前に件数を
-- 数えて記録する」】リモートD1への適用は016以降deploy.ymlが無人で行うため、
-- ここでの件数はscripts/check-remote-migration-preconditions.mjsが
-- 適用直前に数え、デプロイのジョブログに出力する（Rレビュー指摘。
-- worklog.mdへの追記は無人ジョブからは行わない。0013のCHECK制約違反行数の
-- 確認と同じ仕組みに載せた）
DELETE FROM `invite_failures`;--> statement-breakpoint
ALTER TABLE `invite_failures` ADD `account_hash` text NOT NULL;--> statement-breakpoint
CREATE INDEX `invite_failures_account_created_idx` ON `invite_failures` (`account_hash`,`created_at`);