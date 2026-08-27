import { oc } from "@orpc/contract";
import { z } from "zod";

// me.get: 現在ログイン中のユーザー。未認証なら null を返す
// （デモ閲覧モードの返却は未実装。005 以降でペア情報とあわせて拡張する）
export const meGetContract = oc.output(
  z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.email(),
      image: z.string().nullable(),
    })
    .nullable(),
);
