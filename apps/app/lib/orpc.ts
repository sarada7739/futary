import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "@futary/contract";
import { apiOrigin } from "./api-origin";

const link = new RPCLink({
  url: `${apiOrigin}/api`,
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
});

export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
