import type { EventId } from "@mysten/sui/client";

export function cursorToString(cursor: EventId | null | undefined): string | null {
  if (cursor == null) return null;
  return JSON.stringify(cursor);
}

export function stringToCursor(raw: string | null | undefined): EventId | null {
  if (raw == null || raw === "") return null;
  return JSON.parse(raw) as EventId;
}
