import { describe, it, expect, vi } from "vitest";
import { disableLegacyPlugins } from "./legacy-plugins";

const registry = (enabled: string[], loaded: string[]) => {
  const reg = {
    enabledPlugins: new Set(enabled),
    plugins: Object.fromEntries(loaded.map((id) => [id, {}])) as Record<string, unknown>,
    disablePluginAndSave: vi.fn(async (id: string) => {
      reg.enabledPlugins.delete(id);
      delete reg.plugins[id];
      return true;
    }),
  };
  return reg;
};

describe("disableLegacyPlugins", () => {
  it("disables the legacy core when it is enabled", async () => {
    const reg = registry(["hubfolks", "obsidian-together"], ["hubfolks", "obsidian-together"]);
    expect(await disableLegacyPlugins(reg, "hubfolks")).toEqual(["obsidian-together"]);
    expect(reg.disablePluginAndSave).toHaveBeenCalledWith("obsidian-together");
    expect(reg.enabledPlugins.has("obsidian-together")).toBe(false);
  });

  it("unloads a legacy core still running although no longer enabled or installed", async () => {
    // Plugin folder removed while Obsidian ran: its instance (and its sync engine) stays in memory.
    const reg = registry(["hubfolks"], ["hubfolks", "obsidian-together"]);
    expect(await disableLegacyPlugins(reg, "hubfolks")).toEqual(["obsidian-together"]);
    expect(reg.plugins["obsidian-together"]).toBeUndefined();
  });

  it("does nothing when no legacy core is around", async () => {
    const reg = registry(["hubfolks"], ["hubfolks"]);
    expect(await disableLegacyPlugins(reg, "hubfolks")).toEqual([]);
    expect(reg.disablePluginAndSave).not.toHaveBeenCalled();
  });

  it("never disables itself", async () => {
    const reg = registry(["obsidian-together"], ["obsidian-together"]);
    expect(await disableLegacyPlugins(reg, "obsidian-together")).toEqual([]);
  });

  it("keeps going when one legacy core fails to disable", async () => {
    const reg = registry(["obsidian-together"], ["obsidian-together"]);
    reg.disablePluginAndSave.mockRejectedValueOnce(new Error("boom"));
    expect(await disableLegacyPlugins(reg, "hubfolks")).toEqual([]);
  });
});
