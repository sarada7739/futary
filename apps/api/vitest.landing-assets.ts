// 054 T4・056 T6: apps/landing/assets/ の一覧を Vite の仮想モジュールでテストに渡す（テストは workerd で
// node:fs が無い）。056 で PNG のアルファ（画面の中央が透明・縁が不透明）も足した。
// PNG の読みは依存を増やさず node:zlib で（IHDR・IDAT・フィルタの 5 種。RGBA 8bit の非インターレースだけ）
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import type { Plugin } from "vite";

export const LANDING_ASSETS_ID = "virtual:landing-assets";

export interface LandingAsset {
  name: string;
  bytes: number;
  // PNG（RGBA 8bit）だけ: 幅・高さと、指定した点のアルファ
  png?: { width: number; height: number; alphaAt: Record<string, number> };
}

// 読みたい点（比率で指定。0..1）。phone-frame.png: 中央（画面）・左の縁・左上の角（外側）・ノッチの中央
const SAMPLE_POINTS: Record<string, [number, number]> = {
  center: [0.5, 0.5],
  leftBezel: [0.175, 0.5], // x 179/1024（縁は 159〜207）
  topLeftOutside: [0.02, 0.02],
  notch: [0.5, 0.09], // y 140/1536（ノッチは 114〜166）
  screenBottom: [0.5, 0.9], // y 1382/1536（画面は 1426 まで）
};

const PAETH = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function readPngAlpha(file: string): LandingAsset["png"] | undefined {
  const buf = readFileSync(file);
  if (buf.length < 8 || buf.toString("latin1", 1, 4) !== "PNG") return undefined;
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  // RGBA 8bit・非インターレースだけ扱う（それ以外は undefined = テストが「読めない」で赤になる）
  if (colorType !== 6 || bitDepth !== 8 || interlace !== 0) return undefined;
  const bpp = 4;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= bpp ? out[dst + i - bpp]! : 0;
      const b = y > 0 ? out[dst - stride + i]! : 0;
      const c = y > 0 && i >= bpp ? out[dst - stride + i - bpp]! : 0;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else v = x + PAETH(a, b, c);
      out[dst + i] = v & 0xff;
    }
  }
  const alphaAt: Record<string, number> = {};
  for (const [name, [fx, fy]] of Object.entries(SAMPLE_POINTS)) {
    const x = Math.min(width - 1, Math.round(fx * width));
    const y = Math.min(height - 1, Math.round(fy * height));
    alphaAt[name] = out[y * stride + x * bpp + 3]!;
  }
  return { width, height, alphaAt };
}

export function landingAssetsPlugin(landingAssetsDir: string): Plugin {
  return {
    name: "landing-assets",
    resolveId(id) {
      return id === LANDING_ASSETS_ID ? `\0${LANDING_ASSETS_ID}` : null;
    },
    load(id) {
      if (id !== `\0${LANDING_ASSETS_ID}`) return null;
      const files: LandingAsset[] = readdirSync(landingAssetsDir).map((name) => {
        const file = path.join(landingAssetsDir, name);
        const asset: LandingAsset = { name, bytes: statSync(file).size };
        if (name.endsWith(".png")) asset.png = readPngAlpha(file);
        return asset;
      });
      // 056 T5: style.css の本文も渡す（vitest は CSS を空にする〈test.css〉ので ?raw では読めない）
      const styleCss = readFileSync(path.join(landingAssetsDir, "..", "style.css"), "utf8");
      return `export default ${JSON.stringify(files)};
export const styleCss = ${JSON.stringify(styleCss)};`;
    },
  };
}
