import type { Stats } from "@futary/contract";

// 019: primary_date='none'（hidden）は非表示。dating/marriedそれぞれに
// upcoming（あと○日）の対がある（Aの決定・PR #123）。
// ホームの記念日カード（stats-card.tsx）と統計ページ（app/stats.tsx）の
// 両方で使うため共有する（表示名の決め方を2箇所に持たない。019と同じ方針）
export function daysTogetherLabel(daysTogether: Stats["daysTogether"]): string | null {
  if (daysTogether.status === "dating") return `付き合って ${daysTogether.days}日目`;
  if (daysTogether.status === "dating_upcoming") return `記念日まで あと${daysTogether.days}日`;
  if (daysTogether.status === "married") return `結婚して ${daysTogether.days}日目`;
  if (daysTogether.status === "married_upcoming") return `結婚まで あと${daysTogether.days}日`;
  return null;
}

export type DaysTogetherParts = { prefix: string; days: number; suffix: string };

// 035: 記念日カード（stats-card.tsx）の「付き合って→大きな数字→日目」の
// 三段表示用。数字だけを大きく見せるため、daysTogetherLabelの1本の文字列
// ではなく前後を分けて返す。stats.tsx（統計ページ）は1行表示のまま
// daysTogetherLabelを使い続けるため、そちらは変えていない
export function daysTogetherParts(daysTogether: Stats["daysTogether"]): DaysTogetherParts | null {
  if (daysTogether.status === "dating") return { prefix: "付き合って", days: daysTogether.days, suffix: "日目" };
  if (daysTogether.status === "dating_upcoming") return { prefix: "記念日まで あと", days: daysTogether.days, suffix: "日" };
  if (daysTogether.status === "married") return { prefix: "結婚して", days: daysTogether.days, suffix: "日目" };
  if (daysTogether.status === "married_upcoming") return { prefix: "結婚まで あと", days: daysTogether.days, suffix: "日" };
  return null;
}
