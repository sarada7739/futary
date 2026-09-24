// 画像アセット。タブ・FAB・ロゴなど複数箇所から使うので packages/ui にまとめる。
// 出自（どの見本から切り出したか・描き起こしたか）は docs/sample/README.md
export { default as iconTabHome } from "../assets/tab-home.png";
export { default as iconTabSearch } from "../assets/tab-search.png";
export { default as iconTabProfile } from "../assets/tab-profile.png";
export { default as iconFabPlus } from "../assets/fab-plus.png";
export { default as logoMark } from "../assets/logo-mark.png";
// カレンダータブ。他のタブと同じ単線・角丸・塗りなしのモノライン。日付の数字は入れない（24px では潰れる）
export { default as iconTabCalendar } from "../assets/tab-calendar.png";
// タイムラインタブ。3 本の横線（長さを変えてフィードらしさを出す）
export { default as iconTabTimeline } from "../assets/tab-timeline.png";
// ホームの機能パネルのアイコン（タブと同じ単線・角丸・塗りなし・単色）。タイムライン・カレンダーは
// タブのアイコンを使い回すので含めない
export { default as iconPanelMemory } from "../assets/panel-memory.png";
export { default as iconPanelStats } from "../assets/panel-stats.png";
export { default as iconPanelToday } from "../assets/panel-today.png";
export { default as iconPanelList } from "../assets/panel-list.png";
export { default as iconPanelMood } from "../assets/panel-mood.png";
export { default as iconPanelAi } from "../assets/panel-ai.png";
// 機能パネル「ほしいもの」のアイコン（ハート。panel-*.png と同じ規格: 96×96・単色 #4A3733・単線・塗りなし）
export { default as iconPanelWant } from "../assets/panel-want.png";
// 機能パネル「アルバム」のアイコン（写真が 1 枚入ったアルバムの本。重なった写真は「思い出」が使っている）
export { default as iconPanelAlbum } from "../assets/panel-album.png";
// 記念日カード・デモバナーの装飾のスパークル（ピンクの 4 方向の星）
export { default as sparkle } from "../assets/sparkle.png";
// Screen の地に敷く光のボケ（モックの人物も文字も無い背景の帯から切り出した）
export { default as bokeh } from "../assets/bokeh.png";
// 機能パネルの写真タイル（600×600 の JPEG。写真なので PNG より 1/10 の容量）。
// 差し替えるときはここだけを変える（差し替え口はこの 1 箇所）
export { default as panelPhotoTimeline } from "../assets/panel-white-timeline.jpg";
export { default as panelPhotoCalendar } from "../assets/panel-white-calendar.jpg";
export { default as panelPhotoMemory } from "../assets/panel-white-memory.jpg";
export { default as panelPhotoStats } from "../assets/panel-white-stats.jpg";
export { default as panelPhotoToday } from "../assets/panel-white-today.jpg";
export { default as panelPhotoList } from "../assets/panel-white-list.jpg";
export { default as panelPhotoMood } from "../assets/panel-white-mood.jpg";
export { default as panelPhotoAi } from "../assets/panel-white-ai.jpg";
// 機能パネル「ほしいもの」の写真タイル（商品の 2×2 のグリッド）
export { default as panelPhotoWant } from "../assets/panel-white-want.jpg";
// 機能パネル「アルバム」の写真タイル
export { default as panelPhotoAlbum } from "../assets/panel-white-album.jpg";
// ホワイトの統計画面のヒーロー写真（仮。本物が来たら差し替える）
export { default as statsHeroPlaceholder } from "../assets/stats-hero-placeholder.jpg";
// ホームの「リリース履歴を見る」の ✦（96×96・単色・単線。再現は artifacts/043/scripts/make-assets.py）
export { default as iconReleases } from "../assets/panel-releases.png";
// 「新機能のお知らせ」の上の贈り物の絵（ホワイト）。ピンクは sparkle.png を使う（部品の中で分岐）
export { default as releaseGift } from "../assets/release-gift.jpg";
// 写真の上限のシートの鍵と、残りの警告の ⚠（96×96・単色・単線。部品側で tintColor を primary にする。
// 再現は artifacts/045/scripts/make-assets.py）
export { default as iconLock } from "../assets/icon-lock.png";
export { default as iconWarning } from "../assets/icon-warning.png";
// カレンダーの天気の絵 5 つ（晴・曇・雨・雪・雷。112×112 の透過 PNG で、表示は最大 28 CSS px）。
// 切り出しは artifacts/058/scripts/make-icons.py
export { default as weatherSun } from "../assets/weather-sun.png";
export { default as weatherCloud } from "../assets/weather-cloud.png";
export { default as weatherRain } from "../assets/weather-rain.png";
export { default as weatherSnow } from "../assets/weather-snow.png";
export { default as weatherThunder } from "../assets/weather-thunder.png";
