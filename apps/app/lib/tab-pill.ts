// 061: ガラスのタブバーのピル（選択中の印）の位置の計算。
// 描画から切り離して単体で検証できる形にしてある（components/glass-tab-bar.tsx が
// 使う。lib/calendar.ts・lib/root-route.ts と同じ方針で、純粋な計算はここに置く）。
//
// 座標はすべてタブバーの左端からの px。ピルはスロットの中で左右に inset の
// 余白を残すため、休む位置は「スロットの左端 + inset」になる。

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** index 番目のタブの上でピルが休む位置 */
export function pillRestX(index: number, slotWidth: number, inset: number): number {
  return index * slotWidth + inset;
}

/** ドラッグでピルを動かせる右端。タブが1つも無い場合でも inset を下回らない */
export function maxPillX(barWidth: number, slotWidth: number, inset: number): number {
  return Math.max(barWidth - slotWidth + inset, inset);
}

/**
 * 指を離した位置と速さから、寄せる先のタブを決める。
 *
 * 速く振ったぶんだけ先を見る（`velocityX * slotWidth * LOOK_AHEAD`）。
 * 位置だけで決めると、勢いよく振っても隣までしか動かず「指に付いてこない」
 * と感じるため（要件5「離すと最寄りのタブにスプリングでスナップ」の最寄りを、
 * 静止位置ではなく投げ先で測る）。
 */
const LOOK_AHEAD = 0.4;

export function nearestTabIndex(
  pillX: number,
  velocityX: number,
  slotWidth: number,
  inset: number,
  count: number,
): number {
  if (slotWidth <= 0 || count <= 0) return 0;
  const projected = pillX + velocityX * slotWidth * LOOK_AHEAD;
  return clamp(Math.round((projected - inset) / slotWidth), 0, count - 1);
}

/**
 * 動いている速さに応じた横の伸び（scaleX）。1 が伸びていない状態。
 * 上限を置かないと、速く振ったときにピルが画面を横切る帯になる。
 */
export const MAX_STRETCH = 0.35;
const STRETCH_PER_VELOCITY = 0.25;

export function stretchForVelocity(velocityX: number): number {
  return 1 + Math.min(Math.abs(velocityX) * STRETCH_PER_VELOCITY, MAX_STRETCH);
}

/**
 * ピルが乗ってよいスロットの中から、一番近いものを選ぶ。
 *
 * ＋投稿（FAB）はタブではなく、選ばれた状態になることが無い（tabPress が
 * preventDefault され /compose が開く）。そのスロットへ寄せてしまうと、
 * 選択は変わらないのにピルだけがそこへ取り残される。ドラッグの寄せ先からは
 * 最初から外す。
 *
 * allowed は昇順で渡す。空なら index をそのまま返す（寄せ先が無い）。
 */
export function nearestAllowedIndex(index: number, allowed: readonly number[]): number {
  if (allowed.length === 0) return index;
  let best = allowed[0] as number;
  for (const candidate of allowed) {
    if (Math.abs(candidate - index) < Math.abs(best - index)) best = candidate;
  }
  return best;
}
