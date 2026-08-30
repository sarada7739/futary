import type { Event } from "@futary/contract";

// 表示は「12:00〜13:00」。終了が無ければ「12:00」のまま（022。architecture.md 5節）
export function formatEventTimeRange(event: Pick<Event, "startTime" | "endTime">): string {
  if (!event.startTime) return "";
  if (!event.endTime) return event.startTime;
  return `${event.startTime}〜${event.endTime}`;
}
