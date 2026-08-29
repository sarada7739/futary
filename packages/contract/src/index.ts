import { healthGetContract } from "./health";
import { meGetContract } from "./me";
import { coupleCreateContract, coupleGetContract, coupleUpdateContract } from "./couple";
import { inviteAcceptContract, inviteIssueContract } from "./invite";
import { postCreateContract, postDeleteContract, postListContract, postUploadUrlContract } from "./post";
import { reactionToggleContract } from "./reaction";

export type { Post } from "./post";
export { REACTION_KINDS } from "./reaction";

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
  post: {
    list: postListContract,
    create: postCreateContract,
    delete: postDeleteContract,
    uploadUrl: postUploadUrlContract,
  },
  reaction: {
    toggle: reactionToggleContract,
  },
};

export type Contract = typeof contract;
