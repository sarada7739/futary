// LP「さわってみる」の 3D のスマホの傾き（068）。DOM・three.js に触らない純粋な計算だけを置く（テストする）

// 傾きの上下限（rad）。x は上下（手前・奥へ倒す）、y は左右（約 80°。裏面は見せない）
export const MAX_TILT_X = 0.5;
export const MAX_TILT_Y = 1.4;
// ドラッグ 1px あたりの傾き（rad）
export const TILT_PER_PIXEL = 0.006;
// 離してから正面に戻るまでの目安（秒）。この時間で 1% まで減る
export const RETURN_SECONDS = 0.6;
// これより小さくなったら 0 にして止める（rad）
export const REST_EPSILON = 0.001;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// 押した時点の傾き start と、そこからのドラッグ量（px）から、今の傾きを返す。
// 右へ引くと y が増え（右の縁が奥へ）、下へ引くと x が増える（上の縁が手前へ）。
// yOnly（タッチ）のときは x を押した時点のまま（縦のスワイプはページのスクロールに任せる）
export function tiltFromDrag(start, dx, dy, { yOnly = false } = {}) {
  return {
    x: yOnly ? start.x : clamp(start.x + dy * TILT_PER_PIXEL, -MAX_TILT_X, MAX_TILT_X),
    y: clamp(start.y + dx * TILT_PER_PIXEL, -MAX_TILT_Y, MAX_TILT_Y),
  };
}

// 離したあと、dt 秒ぶん正面へ戻す（指数の減衰。RETURN_SECONDS で 1% まで）。十分小さければ 0
export function decayTilt(tilt, dt) {
  const factor = Math.exp((Math.log(0.01) / RETURN_SECONDS) * Math.max(0, dt));
  const next = { x: tilt.x * factor, y: tilt.y * factor };
  if (Math.abs(next.x) < REST_EPSILON) next.x = 0;
  if (Math.abs(next.y) < REST_EPSILON) next.y = 0;
  return next;
}

export function isAtRest(tilt) {
  return tilt.x === 0 && tilt.y === 0;
}
