import { healthGetContract } from "./health";
import { meGetContract, meUpdateContract, meUploadImageUrlContract } from "./me";
import { coupleCreateContract, coupleGetContract, coupleUpdateContract } from "./couple";
export { PRIMARY_DATE_VALUES } from "./couple";
export type { Couple } from "./couple";
import { inviteAcceptContract, inviteIssueContract } from "./invite";
import { postCreateContract, postDeleteContract, postListContract, postUploadUrlContract } from "./post";
import { reactionToggleContract } from "./reaction";
import {
  eventCreateContract,
  eventDeleteContract,
  eventListContract,
  eventUpdateContract,
} from "./event";
import { statsGetContract } from "./stats";
import { memoryGetContract } from "./memory";

export type { Post } from "./post";
export { REACTION_KINDS } from "./reaction";
export type { Event } from "./event";
export { EVENT_KINDS } from "./event";
export type { DaysTogether, Stats } from "./stats";
export type { MemoryLabel, MemoryResult } from "./memory";
export { MEMORY_LABELS } from "./memory";

export const contract = {
  health: {
    get: healthGetContract,
  },
  me: {
    get: meGetContract,
    update: meUpdateContract,
    uploadImageUrl: meUploadImageUrlContract,
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
  stats: {
    get: statsGetContract,
  },
  memory: {
    get: memoryGetContract,
  },
};

export type Contract = typeof contract;
