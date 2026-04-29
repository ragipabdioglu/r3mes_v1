import { describe, expect, it } from "vitest";
import { cursorToString, stringToCursor } from "./cursor.js";

describe("cursor", () => {
  it("round-trips EventId", () => {
    const id = { txDigest: "abc", eventSeq: "1" };
    const s = cursorToString(id);
    expect(s).toBeTruthy();
    expect(stringToCursor(s)).toEqual(id);
  });

  it("null stays null", () => {
    expect(cursorToString(null)).toBeNull();
    expect(stringToCursor(null)).toBeNull();
  });
});
