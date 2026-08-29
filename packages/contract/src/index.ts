import { healthGetContract } from "./health";
import { meGetContract } from "./me";
import { coupleCreateContract, coupleGetContract, coupleUpdateContract } from "./couple";
import { inviteAcceptContract, inviteIssueContract } from "./invite";
import { postCreateContract, postDeleteContract, postListContract, postUploadUrlContract } from "./post";
import { reactionToggleContract } from "./reaction";
import {
  eventCreateContract,
  eventDeleteContract,
  eventListContract,
  eventUpdateContract,
} from "./event";

export type { Post } from "./post";
export { REACTION_KINDS } from "./reaction";
export type { Event } from "./event";
export { EVENT_KINDS } from "./event";

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
  event: {
    list: eventListContract,
    create: eventCreateContract,
    update: eventUpdateContract,
    delete: eventDeleteContract,
  },
};

export type Contract = typeof contract;
