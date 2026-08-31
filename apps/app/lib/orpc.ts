import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "@futary/contract";
import { getApiOrigin } from "./api-origin";

// urlは呼び出しごとに評価される関数で渡す（api-origin.tsのコメント参照。
// `${getApiOrigin()}/api`をここで先に文字列化して渡すと、ビルド時の
// 最適化で固定値に畳み込まれてしまう経路と同じ形になる）
const link = new RPCLink({
  url: () => `${getApiOrigin()}/api`,
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
});

export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
