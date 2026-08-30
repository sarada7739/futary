// docs/sample/透過素材/ から切り出した画像アセット（008）。ボトムタブ・FAB・
// ロゴなど複数箇所から使うため packages/ui にまとめる（docs/sample/README.md）。
// 原本はスプライトシートで、切り出し後に表示サイズの3倍程度まで縮小してある
export { default as iconTabHome } from "../assets/tab-home.png";
export { default as iconTabSearch } from "../assets/tab-search.png";
export { default as iconTabProfile } from "../assets/tab-profile.png";
export { default as iconFabPlus } from "../assets/fab-plus.png";
export { default as logoMark } from "../assets/logo-mark.png";
// カレンダータブ（fix/persistent-tab-bar）。素材シートに該当する図案が無いため
// 新規に描き起こした。既存4つ（単線・角丸・塗りなし・同じ線色）に合わせた
// モノライン。日付の数字は入れていない（24px表示では潰れて読めないため）
export { default as iconTabCalendar } from "../assets/tab-calendar.png";
