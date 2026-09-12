import { describe, expect, it } from "vitest";
import { APPEARANCE_VALUES, COLOR_TOKEN_LIST, isAppearance, themes } from "../src/theme";

// T1（039）: ピンクのトークンが 038 時点と1つも変わっていない。
// 下の写しは 038 時点の packages/ui/src/tokens.ts から手で凍結したもの。
// theme.ts を書き換えても、この写しは書き換えないこと（「ピンクは変えない」の留め金。
// ピンクの値を変える設計判断が下りたときだけ、A の指示で両方を揃える）
const FROZEN_PINK_COLORS = {
  bg: "#FEF6F3",
  surface: "#FFFFFF",
  surfaceTint: "#FCEEEC",
  primary: "#F5868D",
  primaryPressed: "#E4707A",
  primarySubtle: "#FCE4E4",
  brandInk: "#7B4A3C",
  text: "#4A3733",
  textMuted: "#A08C87",
  border: "#F2E0DC",
  overlay: "rgba(20, 15, 14, 0.92)",
  eventAnniversary: "#E36387",
  eventPlan: "#D9A441",
  eventMeetup: "#4C8C8B",
  danger: "#C9423C",
};

const FROZEN_PINK_SHADOW = {
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  fab: {
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  glow: {
    shadowColor: "#F5868D",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
};

const FROZEN_PINK_GRADIENTS = {
  screen: ["#FEF6F3", "#FCEEEC"],
  card: ["#FCEEEC", "#FCE4E4"],
};

describe("T1: ピンクのトークンは 038 時点から変わっていない", () => {
  it("colors が凍結した写しと完全に一致する", () => {
    expect(themes.pink.colors).toEqual(FROZEN_PINK_COLORS);
  });

  it("shadow が凍結した写しと完全に一致する", () => {
    expect(themes.pink.shadow).toEqual(FROZEN_PINK_SHADOW);
  });

  it("gradients が凍結した写しと完全に一致する", () => {
    expect(themes.pink.gradients).toEqual(FROZEN_PINK_GRADIENTS);
  });
});

describe("T2: 両モードのキー集合が同一", () => {
  // 型の Record<ColorToken, string> は余分なキーを弾けないため、Object.keys でも見る
  it("colors のキーが両モードで同一で、COLOR_TOKEN_LIST とも一致する", () => {
    const pinkKeys = Object.keys(themes.pink.colors).sort();
    const whiteKeys = Object.keys(themes.white.colors).sort();
    expect(whiteKeys).toEqual(pinkKeys);
    expect(pinkKeys).toEqual([...COLOR_TOKEN_LIST].sort());
  });

  it("shadow・gradients のキーも両モードで同一", () => {
    expect(Object.keys(themes.white.shadow).sort()).toEqual(Object.keys(themes.pink.shadow).sort());
    expect(Object.keys(themes.white.gradients).sort()).toEqual(Object.keys(themes.pink.gradients).sort());
    for (const key of Object.keys(themes.pink.shadow) as (keyof typeof themes.pink.shadow)[]) {
      expect(Object.keys(themes.white.shadow[key]).sort()).toEqual(Object.keys(themes.pink.shadow[key]).sort());
    }
  });

  it("themes のキーが APPEARANCE_VALUES と一致し、各テーマが自分の appearance を持つ", () => {
    expect(Object.keys(themes).sort()).toEqual([...APPEARANCE_VALUES].sort());
    for (const appearance of APPEARANCE_VALUES) {
      expect(themes[appearance].appearance).toBe(appearance);
    }
  });
});

describe("ホワイトの値の性質（タスク定義3節で縛られた2点）", () => {
  it("機能色（overlay・event-*・danger）はモードで変えない", () => {
    for (const key of ["overlay", "eventAnniversary", "eventPlan", "eventMeetup", "danger"] as const) {
      expect(themes.white.colors[key]).toBe(themes.pink.colors[key]);
    }
  });

  it("影の「無し」は不透明度 0 で表し、FAB の影は残す", () => {
    expect(themes.white.shadow.card.shadowOpacity).toBe(0);
    expect(themes.white.shadow.glow.shadowOpacity).toBe(0);
    expect(themes.white.shadow.fab.shadowOpacity).toBeGreaterThan(0);
  });

  it("グラデーションは平ら（両端が同じ色）", () => {
    expect(themes.white.gradients.screen[0]).toBe(themes.white.gradients.screen[1]);
    expect(themes.white.gradients.card[0]).toBe(themes.white.gradients.card[1]);
  });
});

describe("isAppearance", () => {
  it("2値だけを受け入れ、未知の値・非文字列を弾く", () => {
    expect(isAppearance("pink")).toBe(true);
    expect(isAppearance("white")).toBe(true);
    expect(isAppearance("dark")).toBe(false);
    expect(isAppearance("")).toBe(false);
    expect(isAppearance(null)).toBe(false);
    expect(isAppearance(undefined)).toBe(false);
    expect(isAppearance(1)).toBe(false);
  });
});
