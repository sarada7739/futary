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
