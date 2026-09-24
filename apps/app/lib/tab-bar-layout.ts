import { space } from "@futary/ui";

// 浮いたタブバーに隠れないための余白。タブバー自身の高さ・余白と対でここに持つ（画面とタブバーで値がずれない）
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_BOTTOM_MARGIN = space.lg;
// タブバーの高さ・下の余白に加え、コンテンツとの間に少し余白を足す
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_MARGIN + space.md;
