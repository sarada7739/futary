import { healthGetContract } from "./health";
import {
  meDeleteContract,
  meGetContract,
  meSetAiOptInContract,
  meUpdateContract,
  meUploadImageUrlContract,
} from "./me";
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
import {
  wishCreateContract,
  wishDeleteContract,
  wishListContract,
  wishSetDoneContract,
  wishUpdateContract,
} from "./wish";
import { moodClearTodayContract, moodListContract, moodSetTodayContract } from "./mood";
import { aiSummaryGenerateContract, aiSummaryGetContract } from "./ai-summary";

export type { Post, PostImage } from "./post";
export { MAX_POST_IMAGES } from "./post";
export { REACTION_KINDS } from "./reaction";
export type { Event } from "./event";
export { EVENT_KINDS } from "./event";
export type { DaysTogether, Stats } from "./stats";
export type { MemoryLabel, MemoryResult } from "./memory";
export { MEMORY_LABELS } from "./memory";
export type { Wish } from "./wish";
export { MAX_WISH_NOTE_LENGTH, MAX_WISH_TITLE_LENGTH } from "./wish";
export type { MoodEntry } from "./mood";
export type { AiSummary } from "./ai-summary";
export { AI_PROVIDERS, PERIOD_KINDS } from "./ai-summary";

export const contract = {
  health: {
    get: healthGetContract,
  },
  me: {
    get: meGetContract,
    update: meUpdateContract,
    uploadImageUrl: meUploadImageUrlContract,
    delete: meDeleteContract,
    setAiOptIn: meSetAiOptInContract,
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
  wish: {
    list: wishListContract,
    create: wishCreateContract,
    update: wishUpdateContract,
    setDone: wishSetDoneContract,
    delete: wishDeleteContract,
  },
  mood: {
    setToday: moodSetTodayContract,
    clearToday: moodClearTodayContract,
    list: moodListContract,
  },
  aiSummary: {
    get: aiSummaryGetContract,
    generate: aiSummaryGenerateContract,
  },
};

export type Contract = typeof contract;
