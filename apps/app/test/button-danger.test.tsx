import { render, screen } from "@testing-library/react";
import { Button, colors } from "@futary/ui";
import { describe, expect, it } from "vitest";

// #RRGGBB を react-native-web が実際に書き出す rgb(r, g, b) 表記に変換する
// （react-native-webはstyleのcolorを常にrgb()文字列で出力するため、
// トークンのhex値と直接文字列比較できない）
function hexToRgb(hex: string): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// 036: dangerバリアントは塗りつぶしにしない（枠だけ）。危険な操作を
// 押しやすくしないため（architecture.md 7節）。実際に背景がsurfaceのまま
// （primaryで塗っていない）で、danger色の枠線と文字色になっていることを確認する
describe("Button の danger バリアント（036）", () => {
  it("背景は塗りつぶさず、danger色の枠線と文字になる", () => {
    const { container } = render(<Button variant="danger">削除する</Button>);
    const label = screen.getByText("削除する");
    const pressable = container.firstElementChild as HTMLElement | null;
    expect(pressable).not.toBeNull();

    expect(pressable!.style.borderTopColor).toBe(hexToRgb(colors.danger));
    expect(pressable!.style.backgroundColor).toBe(hexToRgb(colors.surface));
    expect(pressable!.style.backgroundColor).not.toBe(hexToRgb(colors.primary));
    expect(label.style.color).toBe(hexToRgb(colors.danger));
  });
});
