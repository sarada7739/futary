// プランと無料枠の画面側の計算と文言（045）。数字は契約の定数から出す（文言に 30 を直書きしない）。
// 「無料プラン」「プレミアム」と書き、「トライアル」「お試し」は使わない（期限が無い）
import {
  PAID_ALBUM_PHOTO_LIMIT,
  type AlbumQuota,
  type BillingInterval,
  type BillingPrice,
  type Plan,
  type PlanState,
} from "@futary/contract";
import { formatDateJa, formatJstMonthDayJa, todayJst } from "@futary/date";

// 残りがこの枚数以下なら、詳細の FAB の上に警告のカードを出す
export const QUOTA_WARNING_THRESHOLD = 5;

// 残り枚数（0 未満にしない。枠を超えている分は消さず、足せないだけ）
export function albumQuotaRemaining(quota: AlbumQuota): number {
  return Math.max(0, quota.limit - quota.used);
}

// 使用量のバーの割合（0〜1）
export function albumQuotaRatio(quota: AlbumQuota): number {
  if (quota.limit <= 0) return 1;
  return Math.min(1, quota.used / quota.limit);
}

// 「27 / 30 枚」
export function albumQuotaCountLabel(quota: AlbumQuota): string {
  return `${quota.used} / ${quota.limit} 枚`;
}

// 「あと 3 枚」。上限なら「上限に達しています」（「あと 0 枚」とは書かない）
export function albumQuotaRemainingLabel(quota: AlbumQuota): string {
  const remaining = albumQuotaRemaining(quota);
  return remaining === 0 ? "上限に達しています" : `あと ${remaining} 枚`;
}

// 詳細の見出しの横の 1 行: 「27 / 30 枚」。上限なら「30 / 30 枚 - 上限に達しています」
export function albumQuotaHeadingLabel(quota: AlbumQuota): string {
  const count = albumQuotaCountLabel(quota);
  return albumQuotaRemaining(quota) === 0 ? `${count} - 上限に達しています` : count;
}

// 警告のカードを出すか（free で残りが QUOTA_WARNING_THRESHOLD 枚以下）
export function shouldWarnQuota(quota: AlbumQuota): boolean {
  return albumQuotaRemaining(quota) <= QUOTA_WARNING_THRESHOLD;
}

// 警告のカードの題: 「残り 4 枚です」
export function quotaWarningTitle(quota: AlbumQuota): string {
  return `残り ${albumQuotaRemaining(quota)} 枚です`;
}

// 警告のカードの本文: 「あと 4 枚で上限（無料プラン 30 枚）に達します」
export function quotaWarningBody(quota: AlbumQuota): string {
  return `あと ${albumQuotaRemaining(quota)} 枚で上限（無料プラン ${quota.limit} 枚）に達します`;
}

// 残り n 枚で n+1 枚以上選んだとき: 「あと n 枚まで入れられます」
export function albumQuotaOverLabel(quota: AlbumQuota): string {
  return `あと ${albumQuotaRemaining(quota)} 枚まで入れられます`;
}

// 上限のシートの「現在のプラン」の 1 行: 「30 枚まで保存可能」
export function freePlanLimitLabel(limit: number): string {
  return `${limit} 枚まで保存可能`;
}

// マイページの 1 行: 「無料」「プレミアム」
export function planLabel(plan: Plan): string {
  return plan === "paid" ? "プレミアム" : "無料";
}

// /premium の「できること」と上限のシートの「写真 50 万枚まで」（万単位。「無制限」とは書かない）
export function paidPhotoLimitLabel(): string {
  return `写真 ${PAID_ALBUM_PHOTO_LIMIT / 10_000} 万枚まで`;
}

// 使用量・警告のカードの「プレミアムで 50 万枚まで」（「無制限に」とは書かない）
export function paidPhotoLimitCtaLabel(): string {
  return `プレミアムで ${PAID_ALBUM_PHOTO_LIMIT / 10_000} 万枚まで`;
}

// 価格: 「¥420 / 月」「¥4,200 / 年」（Stripe の設定が JPY なので他の通貨は来ない）
export function priceLabel(price: BillingPrice, interval: BillingInterval): string {
  const amount = price.currency.toLowerCase() === "jpy" ? `¥${price.amount.toLocaleString("ja-JP")}` : `${price.amount} ${price.currency}`;
  return `${amount} / ${interval === "month" ? "月" : "年"}`;
}

// マイページの 1 行（paid）: 「プレミアム（10月15日に更新）」。期間の終わりで解約済みなら「（10月15日まで）」、
// 期限が無ければ「プレミアム」
export function paidPlanLabel(planExpiresAt: number | null, planCancelAt: number | null = null): string {
  if (planCancelAt !== null) return `プレミアム（${formatJstMonthDayJa(planCancelAt)}まで）`;
  return planExpiresAt === null ? "プレミアム" : `プレミアム（${formatJstMonthDayJa(planExpiresAt)}に更新）`;
}

// プレミアムをやめたあとの帯（047）。判定はサーバの planState で、画面は表示だけ。
// - 猶予中（lockAt あり・未到達）: 「9月30日までに写真を保存してください。それ以降、無料枠を超える写真は見られなくなります」
// - 鍵の後（locked）: 「無料枠を超える 70 枚は見られません」
// 無料枠を超えていなければ（used <= limit）失うものが無いので出さない
export type LockNotice = { kind: "grace"; text: string } | { kind: "locked"; text: string };

export function lockNotice(planState: PlanState | undefined, quota: AlbumQuota | null): LockNotice | null {
  if (!planState || planState.plan !== "free" || planState.lockAt === null || quota === null) return null;
  const over = quota.used - quota.limit;
  if (over <= 0) return null;
  if (planState.locked) return { kind: "locked", text: `無料枠を超える ${over} 枚は見られません` };
  const date = formatDateJa(todayJst(planState.lockAt * 1000));
  return {
    kind: "grace",
    text: `${date}までに写真を保存してください。それ以降、無料枠を超える写真は見られなくなります`,
  };
}

// アルバム詳細の帯（短く）
export function lockNoticeShort(notice: LockNotice): string {
  return notice.kind === "locked" ? notice.text : notice.text.replace("写真を保存してください。それ以降、", "写真を保存してください。");
}
