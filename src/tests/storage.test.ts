import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Stand-in for `window.localStorage` that can be made to throw. */
class FakeStorage {
  readonly data = new Map<string, string>();
  failGet = false;
  failSet = false;

  getItem(key: string): string | null {
    if (this.failGet) throw new Error("SecurityError");
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
}

let storage: FakeStorage;

/** A fresh copy of the module, like a newly opened tab sharing `storage`. */
function openTab() {
  vi.resetModules();
  return import("@/core/storage");
}

beforeEach(() => {
  storage = new FakeStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage", () => {
  it("round-trips settings and best scores through localStorage", async () => {
    const tab = await openTab();
    tab.saveSettings({ muted: true, units: "imperial" });
    expect(tab.submitScore("backflip", 1234.4)).toBe(true);
    expect(tab.submitScore("backflip", 900)).toBe(false);

    const reloaded = await openTab();
    expect(reloaded.loadSettings()).toEqual({ muted: true, units: "imperial" });
    expect(reloaded.loadBestScores()).toEqual({ backflip: 1234 });
  });

  it("keeps a better best saved by another tab", async () => {
    const tab = await openTab();
    expect(tab.submitScore("kickflip", 500)).toBe(true);
    const other = await openTab();
    expect(other.submitScore("kickflip", 2000)).toBe(true);

    expect(tab.submitScore("kickflip", 1500)).toBe(false);
    expect(tab.loadBestScores()).toEqual({ kickflip: 2000 });
    expect(JSON.parse(storage.data.get("rdstr.best") ?? "")).toEqual({
      kickflip: 2000,
    });
  });

  it("falls back to memory when localStorage throws", async () => {
    storage.data.set("rdstr.best", JSON.stringify({ backflip: 800 }));
    const tab = await openTab();
    expect(tab.loadBestScores()).toEqual({ backflip: 800 });

    storage.failGet = true;
    storage.failSet = true;
    expect(tab.loadBestScores()).toEqual({ backflip: 800 });
    expect(tab.submitScore("backflip", 900)).toBe(true);
    expect(tab.submitScore("backflip", 850)).toBe(false);
    expect(tab.loadBestScores()).toEqual({ backflip: 900 });
    tab.saveSettings({ muted: true, units: "imperial" });
    expect(tab.loadSettings()).toEqual({ muted: true, units: "imperial" });
    expect(storage.data.get("rdstr.best")).toBe(
      JSON.stringify({ backflip: 800 })
    );
  });

  it("keeps writes in memory when only setItem throws (quota)", async () => {
    storage.data.set("rdstr.best", JSON.stringify({ backflip: 100 }));
    storage.failSet = true;
    const tab = await openTab();
    expect(tab.submitScore("backflip", 500)).toBe(true);
    expect(tab.loadBestScores()).toEqual({ backflip: 500 });
    expect(tab.submitScore("backflip", 300)).toBe(false);
  });

  it("ignores invalid JSON and invalid values", async () => {
    storage.data.set("rdstr.settings", "{oops");
    storage.data.set(
      "rdstr.best",
      JSON.stringify({ backflip: -5, kickflip: "9000" })
    );
    const tab = await openTab();
    expect(tab.loadSettings()).toEqual({ muted: false, units: "metric" });
    expect(tab.loadBestScores()).toEqual({});

    for (const json of ["null", "42", '"text"', "[1000]"]) {
      storage.data.set("rdstr.settings", json);
      storage.data.set("rdstr.best", json);
      expect(tab.loadSettings()).toEqual({ muted: false, units: "metric" });
      expect(tab.loadBestScores()).toEqual({});
    }

    storage.data.set("rdstr.best", "not json");
    expect(tab.submitScore("kickflip", 42)).toBe(true);
    expect(tab.loadBestScores()).toEqual({ kickflip: 42 });
  });
});
