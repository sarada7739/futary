// ガラスのタブバーのピル（選択中の印）の位置の計算（061）。描画から切り離して単体で試せる形にする。
// 座標はタブバーの左端からの px。ピルはスロットの中で左右に inset を残すので、休む位置は「左端 + inset」

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
 * 指を離した位置と速さから寄せる先のタブを決める。速く振ったぶんだけ先を見る
 * （`velocityX * slotWidth * LOOK_AHEAD`）。位置だけだと勢いよく振っても隣までしか動かず、指に付いてこない。
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
 * ピルが乗ってよいスロットの中から一番近いものを選ぶ。＋投稿（FAB）は選ばれた状態にならない
 * （tabPress が preventDefault され /compose が開く）ので、寄せるとピルだけ取り残される。
 * 同じ距離に 2 つある（ちょうど FAB を指した）ときは動いていた向きの側（常に左だと、カレンダーから
 * タイムラインへ投げたとき戻ってしまう）。direction が 0 なら左。allowed は昇順。空なら index をそのまま返す。
 */
export function nearestAllowedIndex(
  index: number,
  allowed: readonly number[],
  direction = 0,
): number {
  if (allowed.length === 0) return index;
  let best = allowed[0] as number;
  for (const candidate of allowed) {
    const gap = Math.abs(candidate - index);
    const bestGap = Math.abs(best - index);
    if (gap < bestGap) {
      best = candidate;
    } else if (gap === bestGap && direction !== 0) {
      // 同じ距離なら、動いていた向きの側を採る
      const towardDirection = direction > 0 ? candidate > best : candidate < best;
      if (towardDirection) best = candidate;
    }
  }
  return best;
}
