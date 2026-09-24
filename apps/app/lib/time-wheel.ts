// 時刻のホイールが扱う選択肢の一覧。レイアウトに依存しない部分だけを切り出す（conventions.md 6節）

const MINUTE_STEP = 5;

export const HOUR_OPTIONS: readonly string[] = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

const MINUTE_STEPS: readonly string[] = Array.from({ length: 60 / MINUTE_STEP }, (_, i) =>
  String(i * MINUTE_STEP).padStart(2, "0"),
);

// 刻み（5 分）に乗らない値が既にあれば、丸めずその値を選択肢へ差し込む（触らずに保存しても消えないように。022）
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
