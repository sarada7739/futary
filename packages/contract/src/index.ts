import { healthGetContract } from "./health";
import { meGetContract } from "./me";
import { coupleCreateContract, coupleGetContract, coupleUpdateContract } from "./couple";
import { inviteAcceptContract, inviteIssueContract } from "./invite";

export const contract = {
  health: {
    get: healthGetContract,
  },
  me: {
    get: meGetContract,
  },
  couple: {
    create: coupleCreateContract,
    get: coupleGetContract,
    update: coupleUpdateContract,
  },
  invite: {
    issue: inviteIssueContract,
    accept: inviteAcceptContract,
  },
};

export type Contract = typeof contract;
