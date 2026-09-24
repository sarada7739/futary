import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "@futary/contract";
import { getApiOrigin } from "./api-origin";
import { frameCredentials } from "./demo-frame";

// url は呼び出しごとに評価する関数で渡す（先に文字列にすると、ビルドの最適化で固定値に畳み込まれるのと同じ形になる。
// api-origin.ts）。LP のスマホの枠の中では Cookie を送らない（枠の中は常に未認証 = デモペア。056）
const link = new RPCLink({
  url: () => `${getApiOrigin()}/api`,
  fetch: (input, init) => fetch(input, { ...init, credentials: frameCredentials() }),
});

export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
