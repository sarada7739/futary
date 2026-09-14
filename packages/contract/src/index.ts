import { healthGetContract } from "./health";
import {
  meDeleteContract,
  meGetContract,
  meSetAiOptInContract,
  meUpdateContract,
  meUploadImageUrlContract,
} from "./me";
import { coupleCreateContract, coupleGetContract, coupleUpdateContract } from "./couple";
export { FREE_ALBUM_PHOTO_LIMIT, PLAN_VALUES, PRIMARY_DATE_VALUES } from "./couple";
export type { AlbumQuota, Couple, CoupleWithPlan, Plan } from "./couple";
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
import {
  wantCreateContract,
  wantDeleteContract,
  wantListContract,
  wantSetImageContract,
  wantSetObtainedContract,
  wantUpdateContract,
  wantUploadUrlContract,
} from "./want";
import { aiSummaryGenerateContract, aiSummaryGetContract } from "./ai-summary";
import {
  albumAddPhotosContract,
  albumCreateContract,
  albumDeleteContract,
  albumGetContract,
  albumListContract,
  albumRemovePhotosContract,
  albumUpdateContract,
  albumUpdatePhotoContract,
  albumUploadUrlContract,
  photoDownloadUrlContract,
  photoListContract,
} from "./album";

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
export type { Want, WantOwnerSide } from "./want";
export { isHttpUrl, MAX_WANT_NOTE_LENGTH, MAX_WANT_TITLE_LENGTH, MAX_WANT_URL_LENGTH, WANT_OWNER_SIDES } from "./want";
export type { AiSummary } from "./ai-summary";
export { AI_PROVIDERS, PERIOD_KINDS } from "./ai-summary";
export type { Album, Photo, PhotoRef } from "./album";
export {
  MAX_ALBUM_NOTE_LENGTH,
  MAX_ALBUM_TITLE_LENGTH,
  MAX_PHOTO_CAPTION_LENGTH,
  MAX_PHOTOS_PER_ADD,
  MAX_PHOTOS_PER_REMOVE,
  PHOTO_LIST_DEFAULT_LIMIT,
  PHOTO_LIST_MAX_LIMIT,
  TIMELINE_ALBUM_ID,
  TIMELINE_PREVIEW_COUNT,
} from "./album";

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
  want: {
    list: wantListContract,
    create: wantCreateContract,
    update: wantUpdateContract,
    setImage: wantSetImageContract,
    setObtained: wantSetObtainedContract,
    delete: wantDeleteContract,
    uploadUrl: wantUploadUrlContract,
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
  album: {
    list: albumListContract,
    get: albumGetContract,
    uploadUrl: albumUploadUrlContract,
    create: albumCreateContract,
    update: albumUpdateContract,
    addPhotos: albumAddPhotosContract,
    updatePhoto: albumUpdatePhotoContract,
    removePhotos: albumRemovePhotosContract,
    delete: albumDeleteContract,
  },
  photo: {
    list: photoListContract,
    downloadUrl: photoDownloadUrlContract,
  },
};

export type Contract = typeof contract;
