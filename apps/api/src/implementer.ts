import { implement } from "@orpc/server";
import { contract } from "@futary/contract";
import type { RpcContext } from "./context";

export const implementer = implement(contract).$context<RpcContext>();
