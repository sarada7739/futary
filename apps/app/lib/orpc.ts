import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "@futary/contract";

// 本番はアプリとAPIを同一Workerから配信するため同一オリジンになる。
// ローカル開発は apps/app (Expo) と apps/api (wrangler dev) が別ポートで動くため、
// EXPO_PUBLIC_API_ORIGIN で明示的に指定する（.env.example 参照）
const apiOrigin =
  process.env.EXPO_PUBLIC_API_ORIGIN ??
  (typeof window !== "undefined" && window.location
    ? window.location.origin
    : "http://localhost:8787");

const link = new RPCLink({
  url: `${apiOrigin}/api`,
});

export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
