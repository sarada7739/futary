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

// 離したあと、dt 秒ぶん target（既定は正面）へ戻す（指数の減衰。RETURN_SECONDS で差が 1% まで）。
// 十分近ければ target ちょうどにする
export function decayTilt(tilt, dt, target = FRONT) {
  const factor = Math.exp((Math.log(0.01) / RETURN_SECONDS) * Math.max(0, dt));
  const step = (value, goal) => {
    const next = goal + (value - goal) * factor;
    return Math.abs(next - goal) < REST_EPSILON ? goal : next;
  };
  return { x: step(tilt.x, target.x), y: step(tilt.y, target.y) };
}

export function isAtRest(tilt, target = FRONT) {
  return tilt.x === target.x && tilt.y === target.y;
}

export const FRONT = Object.freeze({ x: 0, y: 0 });

// --- スクロールで斜めから正面へ（追補 3）
// 節が入ってくるときの始めの角度（rad。約 25°・約 8°）。y は正（画面が右の説明文の方を向き、左の側面とボタンが
// 見える）、x は負（上の縁が奥へ）。4 通りを見比べて決めた（artifacts/068/stage4/report.md）
export const ENTRY_TILT = Object.freeze({ x: -0.14, y: 0.44 });

// ステージの上端がビューポートの下端に入った時点 = 0、スマホの中心がビューポートの中心に来た時点 = 1。
// 外は 0 と 1 で止める（中心を過ぎたら正面のまま）。top はステージの上端のビューポートからの位置（px）
export function scrollProgress(top, stageHeight, viewportHeight) {
  const start = viewportHeight;
  const end = viewportHeight / 2 - stageHeight / 2;
  if (start === end) return 1;
  return clamp((start - top) / (start - end), 0, 1);
}

export function easeInCubic(t) {
  return t ** 3;
}

// 残りの割合がこれより小さければ正面にする。正面ちょうどなら iframe を 2D の変形で描けて文字がにじまない
// （0.005 × 0.44 rad ≈ 0.13°。見た目では区別できない）
export const SNAP_REMAINING = 0.005;

// 進み具合（0〜1）→ 角度。0 で ENTRY_TILT、1 で正面。間は easeInCubic（見えている間ははっきり斜めで、中央に
// 近づいてから正面へ向く。ステージがビューポートに近い高さなので、easeOut だと半分見えた頃にはほぼ正面になる）
export function angleForScroll(progress) {
  const remaining = 1 - easeInCubic(clamp(progress, 0, 1));
  if (remaining < SNAP_REMAINING) return { x: 0, y: 0 };
  return { x: ENTRY_TILT.x * remaining, y: ENTRY_TILT.y * remaining };
}
