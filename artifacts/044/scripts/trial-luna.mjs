// 044 停止条件の確認: gpt-5.6-luna が API で受け付けられるか・{{A}} {{B}} の指示に従うか。
// 本番のコード（lib/ai.ts の buildProviderRequest・buildPrompt）をそのまま使って 3 回呼ぶ。
// キーは apps/api/.dev.vars から読む（出力には出さない）
import { readFileSync } from "node:fs";
import { buildPrompt, buildProviderRequest, resolveAiConfig, substituteNames } from "file:///C:/Users/coco7/futary/apps/api/src/lib/ai.ts";

const vars = Object.fromEntries(
  readFileSync("C:/Users/coco7/futary/apps/api/.dev.vars", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const config = resolveAiConfig({ provider: "openai", openaiApiKey: vars.OPENAI_API_KEY });
const entries = [
  { label: "A", body: "今日は朝から公園でランニング。桜が咲き始めていた。" },
  { label: "B", body: "仕事の帰りにケーキを買った。ふたりで食べたら美味しかった。" },
  { label: "A", body: "週末は映画を見に行こうと約束した。" },
  { label: "B", body: "雨だったので家でカレーを作った。少し辛かったかも。" },
  { label: "A", body: "映画は思ったより泣けた。帰りにAランチの店に寄った。" },
];
const prompt = buildPrompt(entries);
const request = buildProviderRequest(config, prompt);

for (let i = 1; i <= 3; i++) {
  const res = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
  console.log(`--- ${i} 回目: status ${res.status} model ${config.model}`);
  if (!res.ok) {
    console.log((await res.text()).slice(0, 300));
    continue;
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  const a = (text.match(/\{\{A\}\}/g) ?? []).length;
  const b = (text.match(/\{\{B\}\}/g) ?? []).length;
  const bare = (text.match(/(?<![A-Za-z{])[AB](?:さん|は|が|の|と|も)/g) ?? []).length;
  console.log(`{{A}}: ${a} 回, {{B}}: ${b} 回, 素の A/B らしきもの: ${bare} 回, 文字数: ${text.length}, 応答モデル: ${json.model}, usage: ${JSON.stringify(json.usage?.completion_tokens_details ?? json.usage)}`);
  console.log(text);
  console.log("→ 置き換え後:");
  console.log(substituteNames(text, { A: "はな", B: "たろう" }));
}
