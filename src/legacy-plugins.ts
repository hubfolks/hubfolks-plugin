/**
 * Plugin IDs this core replaced. A legacy core left running loads its own copy of the
 * sub-plugins — a second sync engine on the same vault, and both re-push each other's
 * writes forever.
 */
export const LEGACY_PLUGIN_IDS = ["obsidian-together"];

/** The part of Obsidian's (internal) `app.plugins` used here. */
export interface PluginRegistry {
  enabledPlugins: Set<string>;
  plugins: Record<string, unknown>;
  disablePluginAndSave(id: string): Promise<unknown>;
}

/**
 * Disables every legacy core that is enabled or still running — a plugin whose folder was
 * removed while Obsidian ran stays loaded until the app reloads. Returns the IDs disabled.
 */
export async function disableLegacyPlugins(registry: PluginRegistry, selfId: string): Promise<string[]> {
  const disabled: string[] = [];
  for (const id of LEGACY_PLUGIN_IDS) {
    if (id === selfId) continue;
    if (!registry.enabledPlugins.has(id) && !registry.plugins[id]) continue;
    try {
      await registry.disablePluginAndSave(id);
      disabled.push(id);
    } catch {
      // Best effort: the sync lock in community still keeps a second engine idle.
    }
  }
  return disabled;
}
