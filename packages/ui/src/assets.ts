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
// 035: 記念日カード・デモバナーの装飾用スパークル。同スプライトシート
// （6sj6V6ve.png）から、ピンクの4方向の星を切り出した
export { default as sparkle } from "../assets/sparkle.png";
// 035視覚仕様4節: Screenの地に敷く光のボケ。新しく作るのではなく、
// docs/sample/mockup/signin.jpgのy260〜560px（人物も文字も無い純粋な
// 背景の帯）を切り出した。出自はdocs/sample/README.md参照
export { default as bokeh } from "../assets/bokeh.png";
// 039 段階2: ホワイトの機能パネルの写真タイル8枚。人間が docs/sample/simpleMode/ に
// 置いた 1254×1254 の生成画像（ファイル名は生成元の都合で中身とずれている。
// A が中身で対応づけた表はタスク定義「アセット到着」節）を、役割の名前で 600×600 の
// JPEG に切り出した（写真なので PNG より 1/10 の容量。出自は docs/sample/README.md）。
// 写真を差し替えるときはここだけを変える（差し替え口はこの1箇所。タスク定義 5-2 c）
export { default as panelPhotoTimeline } from "../assets/panel-white-timeline.jpg";
export { default as panelPhotoCalendar } from "../assets/panel-white-calendar.jpg";
export { default as panelPhotoMemory } from "../assets/panel-white-memory.jpg";
export { default as panelPhotoStats } from "../assets/panel-white-stats.jpg";
export { default as panelPhotoToday } from "../assets/panel-white-today.jpg";
export { default as panelPhotoList } from "../assets/panel-white-list.jpg";
export { default as panelPhotoMood } from "../assets/panel-white-mood.jpg";
export { default as panelPhotoAi } from "../assets/panel-white-ai.jpg";
// 039 段階2: ホワイトの統計画面のヒーロー写真（仮）。人間からのヒーロー画像はまだ
// 無いため、docs/sample/風景/RcmUGlPg.jpg（夕暮れの海辺に立つ男女。後ろ姿。AI 生成）を
// 中央で 4:3（1280×960）に切り出して仮に置いている。本物が来たらここを差し替える
export { default as statsHeroPlaceholder } from "../assets/stats-hero-placeholder.jpg";
