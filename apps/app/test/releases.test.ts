import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatReleaseDate, LATEST_RELEASE, LATEST_VERSION, RELEASES } from "../lib/releases";

// 043 T1: RELEASES の不変条件（タスク定義 1節）。新しい順・version が重複しない・items が 1〜5 行で
// 各 40 文字まで・LATEST_VERSION が先頭・route が (tabs) の既存の画面。
// 機能を足すたびに 1 項目足す（conventions.md 8節）ので、足した項目が形を崩していないことをここで止める

const TABS_DIR = path.join(import.meta.dirname, "..", "app", "(tabs)");

describe("RELEASES（043 T1）", () => {
  it("1 項目以上あり、先頭が最新（LATEST_VERSION・LATEST_RELEASE は先頭から取る）", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    expect(LATEST_VERSION).toBe(RELEASES[0]!.version);
    expect(LATEST_RELEASE).toBe(RELEASES[0]);
  });

  it("date が新しい順（同じ日は許す。YYYY-MM-DD の文字列比較）", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      const newer = RELEASES[i - 1]!;
      const older = RELEASES[i]!;
      expect(newer.date >= older.date, `${newer.version}（${newer.date}）の次に ${older.version}（${older.date}）`).toBe(true);
    }
  });

  it("date は YYYY-MM-DD、version は x.y.z", () => {
    for (const release of RELEASES) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("version が重複しない", () => {
    const versions = RELEASES.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("items は 1〜5 行で、各 40 文字まで", () => {
    for (const release of RELEASES) {
      expect(release.items.length, release.version).toBeGreaterThanOrEqual(1);
      expect(release.items.length, release.version).toBeLessThanOrEqual(5);
      for (const item of release.items) {
        expect([...item].length, `${release.version}: ${item}`).toBeLessThanOrEqual(40);
      }
    }
  });

  it("route は (tabs) にある画面（/name → app/(tabs)/name.tsx）", () => {
    for (const release of RELEASES) {
      if (!release.route) continue;
      expect(release.route, release.version).toMatch(/^\/[a-z-]+$/);
      const file = path.join(TABS_DIR, `${release.route.slice(1)}.tsx`);
      expect(existsSync(file), `${release.version}: ${release.route} → ${file} が無い`).toBe(true);
    }
  });

  it("最新は 3.3.0（カレンダーに天気と祝日。route /calendar。058）で、初回は 1.0.0（🎉）", () => {
    expect(LATEST_VERSION).toBe("3.3.0");
    expect(LATEST_RELEASE.title).toBe("カレンダーに天気と祝日");
    expect(LATEST_RELEASE.items).toEqual(["マイページで地域を選ぶと、7 日先までの天気が出ます", "祝日が赤くなります"]);
    expect(LATEST_RELEASE.route).toBe("/calendar");
    // 3.2.0 の文言は変えない（出したときの事実）
    const v320 = RELEASES.find((r) => r.version === "3.2.0");
    expect(v320?.items).toEqual(["アルバムの写真を 50 万枚まで保存できます"]);
    // 3.1.0 の文言は変えない（出したときの事実。055 0節 #5）
    const v310 = RELEASES.find((r) => r.version === "3.1.0");
    expect(v310?.items).toEqual(["写真を 5 万枚まで保存できます", "月額と年額から選べます"]);
    // 3.0.0（Nisoine。route 無し）は 3.1.0 の次
    expect(RELEASES[3]?.version).toBe("3.0.0");
    expect(RELEASES[3]?.route).toBeUndefined();
    const first = RELEASES[RELEASES.length - 1]!;
    expect(first.version).toBe("1.0.0");
    expect(first.emoji).toBe("🎉");
  });
});

describe("formatReleaseDate", () => {
  it("YYYY-MM-DD を YYYY.MM.DD にする", () => {
    expect(formatReleaseDate("2026-09-14")).toBe("2026.09.14");
  });
});
