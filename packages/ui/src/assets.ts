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
// タイムラインタブ（020。検索タブを置き換えた）。素材シートに該当する図案が
// 無いため、カレンダーと同じ手順で新規に描き起こした。3本の横線（長さを
// 変えてフィードらしさを出す）。他のタブアイコンと同じ単線・角丸・塗りなし
export { default as iconTabTimeline } from "../assets/tab-timeline.png";
// ホーム機能パネルのアイコン6種（020。docs/sample/README.md「ホーム機能
// パネルのアイコンも描き起こす」）。人間が置いた見本（透過の無いJPEG。
// 使わない理由は同READMEに記録）を見本に、タブアイコンと同じ単線・角丸・
// 塗りなし・単色で新規に描き起こした。タイムライン・カレンダーは既存の
// タブアイコンを使い回すためここには含めない
export { default as iconPanelMemory } from "../assets/panel-memory.png";
export { default as iconPanelStats } from "../assets/panel-stats.png";
export { default as iconPanelToday } from "../assets/panel-today.png";
export { default as iconPanelList } from "../assets/panel-list.png";
export { default as iconPanelMood } from "../assets/panel-mood.png";
export { default as iconPanelAi } from "../assets/panel-ai.png";
