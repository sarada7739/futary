import { colors } from "@futary/ui";
import { EVENT_KINDS, type Event } from "@futary/contract";

export type EventKind = Event["kind"];

export const EVENT_KIND_ORDER: readonly EventKind[] = EVENT_KINDS;

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  anniversary: "記念日",
  plan: "予定",
  meetup: "会った日",
};

// 色だけに頼らず形（グリフ）でも種別を区別する（色覚特性への配慮。011確認観点）
export const EVENT_KIND_GLYPHS: Record<EventKind, string> = {
  anniversary: "●",
  plan: "■",
  meetup: "▲",
};

export const EVENT_KIND_COLORS: Record<EventKind, string> = {
  anniversary: colors.eventAnniversary,
  plan: colors.eventPlan,
  meetup: colors.eventMeetup,
};
