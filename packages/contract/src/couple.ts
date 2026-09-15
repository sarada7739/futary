import { oc } from "@orpc/contract";
import { isValidDate, todayJst, yearsBefore } from "@futary/date";
import { z } from "zod";

const MIN_ANNIVERSARY_DATE = "1900-01-01";

// YYYY-MM-DD 形式・実在する日付・妥当な範囲であることを検証する。
// 日付計算は @futary/date に集約する（architecture.md 5節・L63）。
// 以前はここに JST の「今日」を独自に計算するコードがあり、todayJst の
// 3つ目の重複実装になっていた（011の重複はB自身が気づいたが、こちらはESLint
// ルール導入で機械的に発見した）
//
// 上限は「今日まで」ではなく「1年後まで」（L66・Aの決定）。人間が
// 「記念日が未来の日付なら『あと○日』を出す」を採用したため、未来の記念日を
// 登録できる必要がある。1年後という上限は業務上の意味ではなく、
// 1900-01-01の下限と同じ「打ち間違いを弾くための歯止め」（例: 2126-05-18）
//
// married_date にも同じ形の検証を当てるが、上限の年数だけ違う（019・Aの決定・
// PR #123）。結婚した日も付き合った日と同じ性質（YYYY-MM-DDの暦日・
// 打ち間違いの歯止め）を持つため、上限年数を引数にしてこの関数を再利用する
function dateWithinRangeSchema(fieldLabel: string, yearsAhead: number) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください")
    .refine((value) => isValidDate(value), {
      message: "存在しない日付です",
    })
    .refine((value) => value >= MIN_ANNIVERSARY_DATE, {
      message: `${MIN_ANNIVERSARY_DATE} 以降の日付を指定してください`,
    })
    .refine((value) => value <= yearsBefore(todayJst(), -yearsAhead), {
      message: `${fieldLabel}に${yearsAhead}年より先の日付は指定できません`,
    });
}

const datingDateSchema = dateWithinRangeSchema("付き合った日", 1);
// 上限は2年後（datingDateの1年後より緩い）。婚約から式まで1年半空くのは
// 珍しくないため（019・Aの決定・PR #123。「違うこと自体が意図」と明記されている）
const marriedDateSchema = dateWithinRangeSchema("結婚した日", 2);

// ホーム上部に何を表示するか（019）。'none'は非表示。stats.getのdaysTogetherが
// これを反映する（packages/contract/src/stats.ts）
export const PRIMARY_DATE_VALUES = ["dating", "married", "none"] as const;
const primaryDateSchema = z.enum(PRIMARY_DATE_VALUES);

export const coupleSchema = z.object({
  id: z.string(),
  // NULL許容（023）。登録時には聞かず、マイページであとから設定する。
  // まだ設定していないとき、stats.getのdaysTogetherは'unset'を返す
  datingDate: z.string().nullable(),
  marriedDate: z.string().nullable(),
  primaryDate: primaryDateSchema,
  createdAt: z.number(),
});

export type Couple = z.infer<typeof coupleSchema>;

// 045: ペアのプラン。行が無ければ free。判定はサーバの 1 箇所（apps/api/src/lib/plan.ts）
export const PLAN_VALUES = ["free", "paid"] as const;
export type Plan = (typeof PLAN_VALUES)[number];

// 045: 無料枠。ペア全体で、作ったアルバムに入れた写真の合計枚数（タイムラインは数えない）。
// 環境変数にしない。変えるのはこの定数 1 つ。文言にこの数を直書きしない
export const FREE_ALBUM_PHOTO_LIMIT = 30;

// 048 段階2: プレミアムの「写真 50 万枚まで」（/premium・リリース履歴の文言。055 で 5 万 → 50 万 =
// 1 アルバム 500 枚 × 1,000 件）。文言用の定数で、
// サーバはこの数で止めていない（paid は albumQuota が null = 制限しない。物理上限の扱いは 042）
export const PAID_ALBUM_PHOTO_LIMIT = 500_000;

// 045: 無料枠の残り。paid なら null（制限しない）。used は未削除のアルバムの写真の合計
export const albumQuotaSchema = z.object({
  limit: z.number().int(),
  used: z.number().int(),
});
export type AlbumQuota = z.infer<typeof albumQuotaSchema>;

// 045: couple.get だけが plan と albumQuota を返す（create / update は変えない。
// 枠は couple.get から取り、album.list / album.get には持たない。2 箇所に持たない）
// 048 段階2: 行の出どころ。manual（運営が手で）| stripe（Webhook が書く）。行が無ければ null
export const PLAN_SOURCES = ["manual", "stripe"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export const coupleWithPlanSchema = coupleSchema.extend({
  plan: z.enum(PLAN_VALUES),
  albumQuota: albumQuotaSchema.nullable(),
  // 048 段階2: マイページの「プレミアム（〇月〇日に更新）」と「プランを管理」の出し分けに使う。
  // planExpiresAt は秒（couple_plans.expires_at。stripe なら current_period_end）。無期限・行無しは null。
  // 判定（paid かどうか）はサーバの plan だけを見る（画面で期限を計算し直さない）
  planSource: z.enum(PLAN_SOURCES).nullable(),
  planExpiresAt: z.number().int().nullable(),
  // 「期間の終わりで解約」済みならその終了日時（秒）。画面は「〇月〇日に更新」ではなく「〇月〇日まで」と出す
  planCancelAt: z.number().int().nullable(),
});
export type CoupleWithPlan = z.infer<typeof coupleWithPlanSchema>;

// couple.create: 認証済みユーザーがペアを作り、自分をスロット1で参加させる。
// 日付を一切受け取らない（023。「答えられない質問を必須にしない」。
// 付き合った日はマイページであとから設定する。marriedDate/primaryDateは
// 元々ここでは受け取らない設計だった。結婚前提でペアを作らせない）
export const coupleCreateContract = oc.input(z.object({})).output(coupleSchema).errors({
  // 未認証、または既に別のペアに所属している
  FORBIDDEN: {},
});

// couple.get: 自分が所属するペアを返す。045: plan と albumQuota も（ゲストにも返す。デモは paid）
export const coupleGetContract = oc.output(coupleWithPlanSchema).errors({
  FORBIDDEN: {},
  // 認証済みだがどのペアにも所属していない
  NEEDS_ONBOARDING: { status: 409 },
});

// couple.update: 自分が所属するペアの記念日設定を変更する（019で拡張）。
// 部分更新にはせず、event.updateと同じく全項目を受け取って置き換える
const coupleUpdateInputSchema = z
  .object({
    // NULL許容（023）。「まだ設定していない」を表せないと、結婚した日だけ
    // 覚えている人が結婚した日を設定できない（023タスク定義の要望本体）
    datingDate: datingDateSchema.nullable(),
    marriedDate: marriedDateSchema.nullable(),
    primaryDate: primaryDateSchema,
  })
  // primary_date='married'なのにmarried_dateがNULL、という状態を作らない
  // （DB側のTRIGGERと同じ不変条件。packages/db/src/schema/couple.ts参照）
  .refine((value) => value.primaryDate !== "married" || value.marriedDate !== null, {
    message: "primaryDateがmarriedのときはmarriedDateが必須です",
    path: ["marriedDate"],
  })
  // 結婚が交際開始より前にはならない。datingDateがnullのとき（まだ設定して
  // いない）は比較しようがないため通す（DB側のTRIGGERと同じ判断。023）
  .refine((value) => value.datingDate === null || value.marriedDate === null || value.marriedDate >= value.datingDate, {
    message: "結婚した日は付き合った日より前にはできません",
    path: ["marriedDate"],
  });

export const coupleUpdateContract = oc.input(coupleUpdateInputSchema).output(coupleSchema).errors({
  FORBIDDEN: {},
  NEEDS_ONBOARDING: { status: 409 },
  // DB側のTRIGGER（couples_married_date_required_*）が弾いたとき。
  // 入力スキーマのrefineで通常は到達しないが、防御として宣言しておく
  INVALID_INPUT: { status: 400 },
});
