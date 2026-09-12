import type { Colors } from "@futary/ui";
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

// 039: 静的な colors の export が無くなったため、描画側が useTheme() の colors を
// 渡す関数にした（event-* の3色自体は両モードで同じ値。タスク定義3節）
export function eventKindColorsOf(colors: Colors): Record<EventKind, string> {
  return {
    anniversary: colors.eventAnniversary,
    plan: colors.eventPlan,
    meetup: colors.eventMeetup,
  };
}
