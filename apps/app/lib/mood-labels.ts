// タスク定義3節: 5段階固定。言葉はここで固定する
export const MOOD_LEVELS = [1, 2, 3, 4, 5] as const;

export const MOOD_LABELS: Record<number, string> = {
  1: "わるい",
  2: "よくない",
  3: "ふつう",
  4: "よい",
  5: "とてもよい",
};
