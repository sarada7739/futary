import { space } from "@futary/ui";

// 035（見た目を作り込む）: タブバーを浮かせたことで、画面下端に貼り付いていた
// ときには要らなかった「隠れないための余白」が全画面に必要になった。値は
// (tabs)/_layout.tsxのタブバー自身の高さ・余白と対で持ち、ここ1箇所を直せば
// 両方に反映される（画面側とタブバー側で数値が別々にずれる経路を作らない）。
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_BOTTOM_MARGIN = space.lg;
// タブバーの高さ・画面端からの余白に加え、コンテンツとタブバーの間に
// もう少し呼吸できる余白を足す
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_MARGIN + space.md;
