// テストのフィクスチャを Vite の `?raw` で文字列として読み込むための型（040 T2）
declare module "*?raw" {
  const content: string;
  export default content;
}
