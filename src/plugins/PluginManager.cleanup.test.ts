import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginManager } from './PluginManager';

const noopLogger = { verbose: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
const CP = '.obsidian/community-plugins.json';

function setup(files: Record<string, string>, available: string[]) {
  const adapter = {
    exists: vi.fn(async (p: string) => p in files),
    read: vi.fn(async (p: string) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    }),
    write: vi.fn(async (p: string, c: string) => { files[p] = c; }),
  };
  const pm = new PluginManager({
    app: { vault: { adapter } } as any,
    getSettings: () => ({ devMode: false, devRepoRoot: '' } as any),
    getAuth: () => ({ token: 'tok', serverUrl: 'http://localhost', isLoggedIn: true } as any),
    logger: noopLogger,
  });
  pm['_availablePlugins'] = available.map((id) => ({ id, version: '1.0.0', name: id, description: '', checksum: '', size: 0, previewChecksum: null, previewUrls: {} }));
  return { pm, adapter, files };
}

describe('PluginManager._cleanupGhostCommunityPluginEntries', () => {
  it('removes ghost entries (known id, no top-level manifest)', async () => {
    const { pm, files } = setup({ [CP]: JSON.stringify(['hubfolks', 'music-band', 'obsidian42-brat']) }, ['music-band']);
    await pm['_cleanupGhostCommunityPluginEntries']();
    expect(files[CP]).toBe(JSON.stringify(['hubfolks', 'obsidian42-brat'], null, 2) + '\n');
  });

  it('keeps entry when top-level manifest exists', async () => {
    const { pm, adapter } = setup({
      [CP]: JSON.stringify(['hubfolks', 'music-band']),
      '.obsidian/plugins/music-band/manifest.json': '{}',
    }, ['music-band']);
    await pm['_cleanupGhostCommunityPluginEntries']();
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('never touches ids unknown to the registry', async () => {
    const { pm, adapter } = setup({ [CP]: JSON.stringify(['random-plugin']) }, ['music-band']);
    await pm['_cleanupGhostCommunityPluginEntries']();
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('skips silently when file missing, invalid, or not an array', async () => {
    for (const files of [{}, { [CP]: 'not json' }, { [CP]: '{"a":1}' }, { [CP]: '' }]) {
      const { pm, adapter } = setup(files as any, ['music-band']);
      await expect(pm['_cleanupGhostCommunityPluginEntries']()).resolves.toBeUndefined();
      expect(adapter.write).not.toHaveBeenCalled();
    }
  });

  it('is idempotent', async () => {
    const { pm, adapter } = setup({ [CP]: JSON.stringify(['music-band', 'x']) }, ['music-band']);
    await pm['_cleanupGhostCommunityPluginEntries']();
    await pm['_cleanupGhostCommunityPluginEntries']();
    expect(adapter.write).toHaveBeenCalledTimes(1);
  });
});

// Real files on disk: dev vaults link .obsidian/plugins/hubfolks/sub-plugins to the repo's apps/,
// and the obsolete-plugin cleanup once deleted apps/hub-server, hub-web, hub-cli and plugin-core through it.
describe('PluginManager._cleanupObsoletePlugins', () => {
  const SUB = '.obsidian/plugins/hubfolks/sub-plugins';
  const tmpDirs: string[] = [];
  afterEach(() => { for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  function vaultOnDisk() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cleanup-'));
    tmpDirs.push(root);
    const full = (p: string) => path.join(root, p);
    const adapter = {
      getFullPath: full,
      exists: async (p: string) => fs.existsSync(full(p)),
      list: async (p: string) => {
        const entries = fs.readdirSync(full(p), { withFileTypes: true });
        return {
          files: entries.filter(e => e.isFile()).map(e => `${p}/${e.name}`),
          folders: entries.filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => `${p}/${e.name}`),
        };
      },
      rmdir: async (p: string, recursive: boolean) => fs.rmSync(full(p), { recursive, force: true }),
      read: async (p: string) => fs.readFileSync(full(p), 'utf8'),
      write: async (p: string, c: string) => fs.writeFileSync(full(p), c),
    };
    const pm = new PluginManager({
      app: { vault: { adapter } } as any,
      getSettings: () => ({ devMode: false, devRepoRoot: '' } as any),
      getAuth: () => ({ token: 'tok', serverUrl: 'http://localhost', isLoggedIn: true } as any),
      logger: noopLogger,
      fs,
    });
    const mkdir = (p: string) => fs.mkdirSync(p, { recursive: true });
    return { root, full, pm, mkdir };
  }

  it('never deletes a folder the PluginManager did not install (no main.version)', async () => {
    const { full, pm, mkdir } = vaultOnDisk();
    mkdir(full(`${SUB}/hub-server/src`));
    fs.writeFileSync(full(`${SUB}/hub-server/src/main.ts`), 'server source');

    await pm['_cleanupObsoletePlugins'](new Set(['community']), 'u');

    expect(fs.existsSync(full(`${SUB}/hub-server/src/main.ts`))).toBe(true);
  });

  it('deletes nothing when the sub-plugins folder is a symlink (dev vault linked to the repo)', async () => {
    const { root, full, pm, mkdir } = vaultOnDisk();
    const repoApps = path.join(root, 'repo/apps');
    mkdir(path.join(repoApps, 'old-plugin'));
    fs.writeFileSync(path.join(repoApps, 'old-plugin/main.version'), '1.0.0');
    mkdir(path.dirname(full(SUB)));
    fs.symlinkSync(repoApps, full(SUB));

    await pm['_cleanupObsoletePlugins'](new Set(['community']), 'u');

    expect(fs.existsSync(path.join(repoApps, 'old-plugin/main.version'))).toBe(true);
  });

  it('still deletes an obsolete sub-plugin it installed in a real folder', async () => {
    const { full, pm, mkdir } = vaultOnDisk();
    mkdir(full(`${SUB}/old-plugin`));
    fs.writeFileSync(full(`${SUB}/old-plugin/main.version`), '1.0.0');
    mkdir(full(`${SUB}/community`));
    fs.writeFileSync(full(`${SUB}/community/main.version`), '1.0.0');

    await pm['_cleanupObsoletePlugins'](new Set(['community']), 'u');

    expect(fs.existsSync(full(`${SUB}/old-plugin`))).toBe(false);
    expect(fs.existsSync(full(`${SUB}/community/main.version`))).toBe(true);
  });
});
