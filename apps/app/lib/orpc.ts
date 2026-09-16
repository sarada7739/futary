import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "@futary/contract";
import { getApiOrigin } from "./api-origin";
import { frameCredentials } from "./demo-frame";

// urlは呼び出しごとに評価される関数で渡す（api-origin.tsのコメント参照。
// `${getApiOrigin()}/api`をここで先に文字列化して渡すと、ビルド時の
// 最適化で固定値に畳み込まれてしまう経路と同じ形になる）
// 056: LP のスマホの枠（iframe）の中では Cookie を送らない（frameCredentials）。框の中は常に未認証 = デモペア
const link = new RPCLink({
  url: () => `${getApiOrigin()}/api`,
  fetch: (input, init) => fetch(input, { ...init, credentials: frameCredentials() }),
});

export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
