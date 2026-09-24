import type { Stats } from "@futary/contract";

// hidden（primary_date='none'）は非表示。dating・married それぞれに upcoming（あと○日）の対がある。
// 記念日カードと統計ページの両方で使う（表示の決め方を 2 箇所に持たない。019）
export function daysTogetherLabel(daysTogether: Stats["daysTogether"]): string | null {
  if (daysTogether.status === "dating") return `付き合って ${daysTogether.days}日目`;
  if (daysTogether.status === "dating_upcoming") return `記念日まで あと${daysTogether.days}日`;
  if (daysTogether.status === "married") return `結婚して ${daysTogether.days}日目`;
  if (daysTogether.status === "married_upcoming") return `結婚まで あと${daysTogether.days}日`;
  return null;
}

export type DaysTogetherParts = { prefix: string; days: number; suffix: string };

// 記念日カードの「付き合って → 大きな数字 → 日目」の三段表示用。数字だけを大きく見せるので前後を分けて返す
// （統計ページは 1 行の daysTogetherLabel のまま）
export function daysTogetherParts(daysTogether: Stats["daysTogether"]): DaysTogetherParts | null {
  if (daysTogether.status === "dating") return { prefix: "付き合って", days: daysTogether.days, suffix: "日目" };
  if (daysTogether.status === "dating_upcoming") return { prefix: "記念日まで あと", days: daysTogether.days, suffix: "日" };
  if (daysTogether.status === "married") return { prefix: "結婚して", days: daysTogether.days, suffix: "日目" };
  if (daysTogether.status === "married_upcoming") return { prefix: "結婚まで あと", days: daysTogether.days, suffix: "日" };
  return null;
}
