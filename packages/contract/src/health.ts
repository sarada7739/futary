import { oc } from "@orpc/contract";
import { z } from "zod";

// health.get: サーバの疎通確認用。認証・ペア所属を問わず常に呼べる
export const healthGetContract = oc.output(
  z.object({
    ok: z.literal(true),
    now: z.number(),
  }),
);
