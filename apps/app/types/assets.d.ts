declare module "*.png" {
  const value: number;
  export default value;
}

// 039 段階2: 写真タイル・ヒーロー（packages/ui/assets/*.jpg）。PNG と同じく Metro が
// 数値のアセット ID に解決する（packages/ui/src/jpg.d.ts と対）
declare module "*.jpg" {
  const value: number;
  export default value;
}
