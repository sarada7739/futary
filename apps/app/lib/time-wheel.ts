// 022: 時刻選択ホイールが扱う選択肢の一覧。レイアウトに依存しない部分だけを
// ここに切り出す（conventions.md 6節「レイアウトに依存する計算はテストできない」）。

const MINUTE_STEP = 5;

export const HOUR_OPTIONS: readonly string[] = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

const MINUTE_STEPS: readonly string[] = Array.from({ length: 60 / MINUTE_STEP }, (_, i) =>
  String(i * MINUTE_STEP).padStart(2, "0"),
);

// 刻み（5分）に乗らない値が既に入っているとき、丸めずその値を選択肢へ差し込む
// （022・Aの決定）。「表示できる」だけでなく、触らずに保存しても消えないことが
// 目的なので、この一覧に含まれない値へ丸めてはならない
export function buildMinuteOptions(currentMinute: string): readonly string[] {
  if (MINUTE_STEPS.includes(currentMinute)) return MINUTE_STEPS;
  return [...MINUTE_STEPS, currentMinute].sort();
}

export function splitTime(value: string): { hour: string; minute: string } {
  const [hour = "00", minute = "00"] = value.split(":");
  return { hour, minute };
}

export function joinTime(hour: string, minute: string): string {
  return `${hour}:${minute}`;
}
