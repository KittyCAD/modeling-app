import { FileAlreadyExists } from '@src/lib/fileSystem/fileOperations';
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory';
import noopfs from '@src/lib/fs-zds/noopfs';
import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler';
import { createProjectForTest } from '@src/lib/projectTestUtils';
import { posix } from '@chainner/node-path';
import { testFileOperations } from '@src/lib/fileSystem/testScheduler';
import { projectStorageProvidersFacet, type ProjectStorage } from '@src/lib/projectSession/storage';
import { extension as defineExtension, Registry, slot as createSlot, contribute, provide } from "plankton";
import { signal } from '@preact/signals-core';
import type { KclManager } from '@src/lang/KclManager';
import { getProjectInfo } from '@src/lib/desktop';
import type { Project } from '@src/lib/project';
import type { ZDSProject } from '@src/lib/projectSession';
import type { ModuleType } from '@src/lib/wasm_lib_wrapper';
import { cloudStorageService, type CloudStorageService } from '@src/lib/cloudProjects/registry/contract';
import { fileOperationsService, type FileOperationsRegistryService } from '@src/registry/contracts/fileOperations';
import { projectSession } from '@src/registry/contracts/projectSession';
import { routerService } from '@src/registry/contracts/router';
import { wasmPromiseFacet } from '@src/registry/contracts/wasm';
import { cloudProjectSessionExtension } from '@src/lib/cloudProjects/registry/session';
import projectSessionRegistryItem from '@src/registry/extensions/projectSession';
import { createRouterRegistryService } from '@src/registry/extensions/router';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';
vi.mock('@src/lib/fs-zds', () => ({
  default: posix
}));
vi.mock('@src/lib/desktop', () => ({
  getProjectInfo: vi.fn(),
  writeProjectThumbnailFile: vi.fn(async () => {})
}));
vi.mock('@src/lib/activeTextFile', () => ({
  flushActiveTextFileWrite: vi.fn(async () => {}),
  adoptStorageTextSnapshot: vi.fn()
}));
const metadata = (title = 'Project'): Project => createProjectForTest('/project', {
  name: 'project',
  title,
  default_file: '/project/main.kcl',
  kcl_file_count: 1
});
const registries: Registry[] = [];
afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.dispose();
  vi.resetAllMocks();
});
function createProject(path = '/project/parts/main.kcl') {
  const filePath = signal(path);
  const flush = vi.fn(async () => true);
  const resetForFileSwitch = vi.fn();
  const editor = {
    path,
    flushWriteToFile: flush,
    resetForFileSwitch
  } as unknown as KclManager;
  const project = {
    path: '/project',
    editors: new Map([[0, editor]]),
    projectIORefSignal: signal(metadata()),
    executingPathSignal: signal(filePath),
    executingEditor: signal(editor)
  } as unknown as ZDSProject;
  return {
    project,
    filePath,
    flush,
    resetForFileSwitch
  };
}
async function setup(cloud?: CloudStorageService, storage?: ProjectStorage, operations?: FileOperationsRegistryService) {
  if (cloud) {
    cloud = Object.assign({
      root: '/',
      idFor: (path: string) => posix.relative(cloud!.root, path).match(/^[^/]+/)?.[0] ?? '',
      saves: signal(new Map())
    }, cloud);
  }
  const exists = vi.fn(async () => false);
  const rename = vi.fn(async (_source: string, _destination: string) => {});
  const readFile = vi.fn(async () => new TextEncoder().encode('title = "Project"\ndefault_file = "main.kcl"\n'));
  const writeFile = vi.fn(async () => {});
  const router = createRouterRegistryService();
  const navigate = vi.fn(async (_path?: unknown, _options?: unknown) => {});
  router.setNavigate(navigate);
  const registry = new Registry();
  const lateCloud = createSlot([], Symbol());
  await registry.configure([projectSessionRegistryItem, cloudProjectSessionExtension, defineExtension({
    ...lateCloud,
    create: () => ({
      items: []
    })
  }), [contribute(wasmPromiseFacet, () => Promise.resolve({} as ModuleType)), ...(storage ? [contribute(projectStorageProvidersFacet, () => () => storage)] : []), provide(fileOperationsService, operations ?? {
    exists,
    rename,
    readFile,
    writeFile
  } as unknown as FileOperationsRegistryService), provide(routerService, router), ...(cloud ? [provide(cloudStorageService, cloud)] : [])]]);
  registries.push(registry);
  const session = registry.required(projectSession);
  const current = createProject();
  session.setProject(current.project);
  return {
    registry,
    lateCloud,
    session,
    exists,
    rename,
    readFile,
    writeFile,
    router,
    navigate,
    ...current
  };
}
describe('direct project session file actions', () => {
  it.each([false, true])('retries cloud storage before flushing the live editor on reconnect (switch project: %s)', async switchProject => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<undefined>();
    const retry = vi.fn(() => gate.promise);
    const s = await setup({
      retry
    } as unknown as CloudStorageService);
    s.project.projectIORefSignal.value = {
      ...metadata(),
      cloudProjectId: 'remote'
    };
    try {
      window.dispatchEvent(new Event('online'));
      expect(retry).toHaveBeenCalledExactlyOnceWith('remote');
      await vi.advanceTimersByTimeAsync(7_000);
      expect(s.flush).not.toHaveBeenCalled();
      if (switchProject) s.session.clearProject();
      gate.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.flush).toHaveBeenCalledTimes(switchProject ? 0 : 1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('subscribes when cloud storage becomes available and applies its authoritative snapshot', async () => {
    const s = await setup();
    const adopt = vi.fn();
    Object.assign(s.project.executingEditor.peek()!, {
      adoptStorageSnapshot: adopt
    });
    const reload = vi.fn(async () => {});
    Object.assign(s.project, {
      reloadFilesFromStorage: reload
    });
    await Promise.resolve();
    let listener: ((root: string, files: {
      relativePath: string;
      data: Uint8Array;
    }[]) => void) | undefined;
    const stop = vi.fn();
    const subscribeReconciled = vi.fn((next: NonNullable<typeof listener>) => {
      listener = next;
      return stop;
    });
    await s.registry.replace(s.lateCloud, [[provide(cloudStorageService, {
      subscribeReconciled
    } as unknown as CloudStorageService)]]);
    await vi.waitFor(() => expect(subscribeReconciled).toHaveBeenCalledOnce());
    listener!('/another-project', []);
    expect(adopt).not.toHaveBeenCalled();
    listener!('/project', [{
      relativePath: 'parts/main.kcl',
      data: new TextEncoder().encode('cloud truth')
    }]);
    expect(adopt).toHaveBeenCalledWith('/project', 'cloud truth');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    await s.registry.dispose();
    registries.splice(registries.indexOf(s.registry), 1);
    expect(stop).toHaveBeenCalledOnce();
  });
  it.each(['tree refresh', 'new snapshot', 'project switch'] as const)('keeps a cloud rebuild current across %s only when its snapshot still owns the project', async operation => {
    let reconcile: ((root: string, files: {
      relativePath: string;
      data: Uint8Array;
    }[]) => void) | undefined;
    const s = await setup({
      subscribeReconciled: (listener: NonNullable<typeof reconcile>) => {
        reconcile = listener;
        return () => {};
      }
    } as unknown as CloudStorageService);
    Object.assign(s.project.executingEditor.peek()!, {
      adoptStorageSnapshot: vi.fn()
    });
    const pending = Promise.withResolvers<undefined>();
    const reload = vi.fn(async (_isCurrent: () => boolean) => pending.promise);
    Object.assign(s.project, {
      reloadFilesFromStorage: reload
    });
    await vi.waitFor(() => expect(reconcile).toBeDefined());
    const files = [{
      relativePath: 'parts/main.kcl',
      data: new TextEncoder().encode('cloud source')
    }];
    try {
      reconcile!('/project', files);
      const isCurrent = reload.mock.calls[0][0];
      expect(isCurrent()).toBe(true);
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(7_000);
      if (operation === 'tree refresh') {
        vi.mocked(getProjectInfo).mockResolvedValueOnce(metadata('Fresh'));
        await s.session.refreshProject();
      } else if (operation === 'new snapshot') reconcile!('/project', files);else s.session.setProject(createProject().project);
      expect(isCurrent()).toBe(operation === 'tree refresh');
    } finally {
      pending.resolve(undefined);
      vi.useRealTimers();
    }
  });
  it('stages cloud thumbnails and forwards editor activity without file writes', async () => {
    const stageThumbnail = vi.fn(async () => {});
    const editorChanged = vi.fn();
    const s = await setup({
      root: '/cloud',
      stageThumbnail,
      editorChanged
    } as unknown as CloudStorageService);
    const bytes = new Uint8Array([1, 2]);
    await s.session.writeThumbnail('/cloud/project', bytes);
    s.session.editorChanged('/cloud/project/main.kcl');
    s.session.editorChanged('/local/main.kcl');
    expect(stageThumbnail).toHaveBeenCalledExactlyOnceWith('/cloud/project', bytes);
    expect(editorChanged).toHaveBeenCalledExactlyOnceWith('/cloud/project/main.kcl');
  });
  it('preserves cloud identity and library ownership when refreshing the tree', async () => {
    const s = await setup({
      root: '/',
      idFor: () => 'project',
      saves: signal(new Map())
    } as unknown as CloudStorageService);
    s.project.projectIORefSignal.value = {
      ...metadata(),
      cloudProjectId: 'remote',
      libraryPath: '/library',
      libraryType: 'cloud'
    };
    vi.mocked(getProjectInfo).mockResolvedValueOnce(metadata('Fresh'));
    await s.session.refreshProject();
    expect(getProjectInfo).toHaveBeenCalledWith(expect.anything(), '/project', expect.anything(), {
      createMissingEntrypoint: false
    });
    expect(s.project.projectIORefSignal.value).toMatchObject({
      title: 'Fresh',
      cloudProjectId: 'remote',
      libraryPath: '/library',
      libraryType: 'cloud'
    });
  });
  it('discards a tree read completed after the project changed', async () => {
    const s = await setup();
    const gate = Promise.withResolvers<Project>();
    vi.mocked(getProjectInfo).mockReturnValueOnce(gate.promise);
    const refresh = s.session.refreshProject();
    const next = createProject();
    s.session.setProject(next.project);
    gate.resolve(metadata('Stale'));
    await refresh;
    expect(next.project.projectIORefSignal.value.title).toBe('Project');
    expect(s.project.projectIORefSignal.value.title).toBe('Project');
  });
  it('keeps the newest tree when concurrent reads finish out of order', async () => {
    const s = await setup();
    const gate = Promise.withResolvers<Project>();
    vi.mocked(getProjectInfo).mockReturnValueOnce(gate.promise).mockResolvedValueOnce(metadata('Latest'));
    const previous = s.session.refreshProject();
    await vi.waitFor(() => expect(getProjectInfo).toHaveBeenCalledOnce());
    await s.session.refreshProject();
    gate.resolve(metadata('Old'));
    await previous;
    expect(s.project.projectIORefSignal.value.title).toBe('Latest');
  });
  it('resolves navigation after the router loader finishes and preserves unrelated query parameters', async () => {
    const s = await setup();
    const gate = Promise.withResolvers<undefined>();
    s.navigate.mockImplementationOnce(async () => {
      await gate.promise;
    });
    s.router.setLocation({
      pathname: '/home',
      search: '?keep=value&project-id=remote',
      hash: '',
      state: null,
      key: 'one'
    });
    const complete = vi.fn();
    const opening = s.session.openFile('/project/new.kcl', {
      projectPath: '/project',
      clearProjectId: true
    }).then(complete);
    expect(s.resetForFileSwitch).toHaveBeenCalledOnce();
    expect(s.navigate).toHaveBeenCalledWith(expect.stringContaining('?keep=value'), expect.anything());
    expect(s.navigate.mock.calls[0][0]).not.toContain('project-id=');
    expect(complete).not.toHaveBeenCalled();
    gate.resolve(undefined);
    await opening;
    expect(complete).toHaveBeenCalledOnce();
  });
  it('flushes an affected editor before renaming a folder and updates its owned path', async () => {
    const s = await setup();
    const gate = Promise.withResolvers<boolean>();
    s.flush.mockReturnValueOnce(gate.promise);
    const renaming = s.session.rename('/project/parts', '/project/renamed');
    expect(s.rename).not.toHaveBeenCalled();
    gate.resolve(true);
    await renaming;
    expect(s.rename).toHaveBeenCalledWith('/project/parts', '/project/renamed');
    expect(s.filePath.value).toBe('/project/renamed/main.kcl');
  });
  it('rebinds both the editor and navigation path after moving an open file', async () => {
    const s = await setup();
    await s.session.rename('/project/parts/main.kcl', '/project/moved.kcl');
    expect(s.project.executingEditor.peek()!.path).toBe('/project/moved.kcl');
    expect(s.filePath.value).toBe('/project/moved.kcl');
  });
  it('does not rebind an active file when an unrelated sibling prefix is renamed', async () => {
    const s = await setup();
    s.filePath.value = '/project/parts-extra/main.kcl';
    s.project.executingEditor.peek()!.path = s.filePath.value;
    await s.session.rename('/project/parts', '/project/components');
    expect(s.filePath.value).toBe('/project/parts-extra/main.kcl');
    expect(s.project.executingEditor.peek()!.path).toBe(s.filePath.value);
    expect(s.flush).not.toHaveBeenCalled();
  });
  it.each([['/project/main.kcl', '/project/components/main.kcl', 'components/main.kcl']])('updates entrypoint metadata when moving %s', async (source, destination, relative) => {
    const s = await setup();
    await s.session.rename(source, destination);
    expect(s.writeFile).toHaveBeenCalledWith('/project/project.toml', expect.stringContaining(`default_file = "${relative}"`));
  });
  it('keeps the old path while a cloud move takes seven seconds, then rebinds before persistence', async () => {
    vi.useFakeTimers();
    const gate = Promise.withResolvers<undefined>();
    const persisted = Promise.withResolvers<undefined>();
    const rename = vi.fn(async () => {
      await gate.promise;
    });
    const batch = vi.fn(async (_path: string, run: (operations: FileOperationsRegistryService) => Promise<void>) => {
      await run({
        rename
      } as unknown as FileOperationsRegistryService);
      await persisted.promise;
    });
    const s = await setup({
      root: '/cloud',
      batch
    } as unknown as CloudStorageService);
    s.filePath.value = '/cloud/project/parts/main.kcl';
    s.project.executingEditor.peek()!.path = s.filePath.value;
    const moving = s.session.rename('/cloud/project/parts', '/cloud/project/components');
    await vi.advanceTimersByTimeAsync(7_000);
    expect(rename).toHaveBeenCalledOnce();
    expect(s.project.executingEditor.peek()!.path).toBe('/cloud/project/parts/main.kcl');
    gate.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.project.executingEditor.peek()!.path).toBe('/cloud/project/components/main.kcl');
    expect(s.filePath.value).toBe('/cloud/project/components/main.kcl');
    persisted.resolve(undefined);
    await moving;
    vi.useRealTimers();
  });
  it('cancels a rename when pending edits cannot be saved', async () => {
    const s = await setup();
    s.flush.mockResolvedValueOnce(false);
    await expect(s.session.rename('/project/parts', '/project/new')).rejects.toThrow('unsaved changes');
    expect(s.rename).not.toHaveBeenCalled();
    expect(s.filePath.value).toBe('/project/parts/main.kcl');
  });
  it('refuses a destination collision', async () => {
    const s = await setup();
    s.rename.mockRejectedValueOnce(new FileAlreadyExists({
      operation: 'rename',
      path: '/project/parts',
      cause: {
        code: 'EEXIST'
      },
      message: 'Name already exists.'
    }));
    await expect(s.session.rename('/project/parts', '/project/existing')).rejects.toThrow('already exists');
    expect(s.filePath.value).toBe('/project/parts/main.kcl');
  });
  it('rebinds the live editor after a case-only rename on a case-insensitive backing', async () => {
    const memory = createMemoryFileSystem({
      ...noopfs.impl,
      ...posix,
      resolve: (...parts) => posix.resolve(...parts).normalize('NFD').toLowerCase()
    });
    await memory.mkdir('/project/parts', {
      recursive: true
    });
    await memory.writeFile('/project/parts/main.kcl', new Uint8Array([42]));
    const scheduler = createFileOperationsScheduler({
      ...memory,
      resolve: (...parts) => posix.resolve(...parts)
    });
    const s = await setup();
    s.exists.mockResolvedValue(true);
    s.rename.mockImplementation((...args) => scheduler.operations.rename(...args));
    try {
      await s.session.rename('/project/parts/main.kcl', '/project/parts/Main.kcl');
      expect(s.filePath.value).toBe('/project/parts/Main.kcl');
      expect(s.project.executingEditor.peek()?.path).toBe('/project/parts/Main.kcl');
      expect(await scheduler.operations.readFile('/project/parts/Main.kcl')).toEqual(new Uint8Array([42]));
    } finally {
      await scheduler.dispose();
    }
  });
  it('does not update a replaced project after a captured rename completes', async () => {
    const s = await setup();
    const gate = Promise.withResolvers<undefined>();
    s.rename.mockImplementationOnce(async () => {
      await gate.promise;
    });
    const renaming = s.session.rename('/project/parts', '/project/new');
    await vi.waitFor(() => expect(s.rename).toHaveBeenCalledOnce());
    const next = createProject();
    s.session.setProject(next.project);
    gate.resolve(undefined);
    await renaming;
    expect(next.filePath.value).toBe('/project/parts/main.kcl');
  });
  it('keeps the editor at the renamed memory path if cloud persistence fails', async () => {
    const error = new Error('Save failed');
    const batch = vi.fn(async (_path: string, run: (operations: FileOperationsRegistryService) => Promise<void>) => {
      await run({
        rename: vi.fn(async () => {})
      } as unknown as FileOperationsRegistryService);
      return Promise.reject(error);
    });
    const s = await setup({
      root: '/cloud',
      batch
    } as unknown as CloudStorageService);
    s.filePath.value = '/cloud/project/parts/main.kcl';
    s.project.executingEditor.peek()!.path = s.filePath.value;
    await expect(s.session.rename('/cloud/project/parts', '/cloud/project/renamed')).rejects.toBe(error);
    expect(s.filePath.value).toBe('/cloud/project/renamed/main.kcl');
    expect(s.rename).not.toHaveBeenCalled();
  });
});
function storageForTest(): ProjectStorage {
  return {
    root: '/project',
    writeAvailability: signal({
      writable: true
    }),
    externalChanges: 'snapshot',
    removeWithHistory: vi.fn(async () => ({
      undo: vi.fn(async () => {}),
      redo: vi.fn(async () => {})
    })),
    createMissingEntrypoint: false,
    watch: vi.fn(() => vi.fn()),
    batch: vi.fn(async (_path, run) => run({
      ...testFileOperations
    })),
    refresh: vi.fn(async () => undefined),
    retry: vi.fn(async () => {}),
    editorChanged: vi.fn(),
    writeThumbnail: vi.fn(async () => {})
  };
}
it('releases captured watchers when a watch is replaced, removed, or the session is disposed', async () => {
  const storage = storageForTest();
  const first = vi.fn();
  const second = vi.fn();
  const third = vi.fn();
  vi.mocked(storage.watch).mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third);
  const s = await setup(undefined, storage);
  const io = s.session.textFileIO;
  io.watch('/project/main.kcl', 'editor', vi.fn());
  io.watch('/project/main.kcl', 'editor', vi.fn());
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  io.unwatch('/project/main.kcl', 'editor');
  expect(second).toHaveBeenCalledOnce();
  io.watch('/project/other.kcl', 'editor', vi.fn());
  await s.registry.dispose();
  registries.splice(registries.indexOf(s.registry), 1);
  expect(third).toHaveBeenCalledOnce();
});
it('uses the provider entrypoint policy when refreshing a project', async () => {
  const s = await setup(undefined, storageForTest());
  vi.mocked(getProjectInfo).mockResolvedValueOnce(metadata('Snapshot'));
  await s.session.refreshProject();
  expect(getProjectInfo).toHaveBeenCalledWith(expect.anything(), '/project', expect.anything(), {
    createMissingEntrypoint: false
  });
  expect(s.session.project.peek()?.projectIORefSignal.peek().title).toBe('Snapshot');
});
describe('project deletion through storage capabilities', () => {
  it('deletes and restores real memory-backed files without a cloud service', async () => {
    const memory = createMemoryFileSystem({
      ...noopfs.impl,
      ...posix
    });
    await memory.mkdir('/project/parts', {
      recursive: true
    });
    await memory.writeFile('/project/parts/main.kcl', new TextEncoder().encode('original contents'));
    const scheduler = createFileOperationsScheduler(memory);
    const s = await setup(undefined, undefined, scheduler.operations);
    try {
      const deletion = await s.session.deleteEntry('/project/parts');
      assert(deletion && !(deletion instanceof Error));
      await expect(scheduler.operations.exists('/project/parts')).resolves.toBe(false);
      await deletion.undo();
      expect(new TextDecoder().decode(await scheduler.operations.readFile('/project/parts/main.kcl'))).toBe('original contents');
      await deletion.redo();
      await expect(scheduler.operations.exists('/project/parts')).resolves.toBe(false);
    } finally {
      await scheduler.dispose();
    }
  });
  it('waits for a seven-second editor save before deleting through its backing', async () => {
    vi.useFakeTimers();
    const storage = storageForTest();
    const s = await setup(undefined, storage);
    const saving = Promise.withResolvers<boolean>();
    s.flush.mockReturnValue(saving.promise);
    try {
      const deleting = s.session.deleteEntry('/project/parts');
      await vi.advanceTimersByTimeAsync(7_000);
      expect(storage.removeWithHistory).not.toHaveBeenCalled();
      saving.resolve(true);
      const deletion = await deleting;
      assert(deletion && !(deletion instanceof Error));
      expect(storage.removeWithHistory).toHaveBeenCalledWith('/project/parts');
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps the file when unsaved edits cannot be persisted', async () => {
    const storage = storageForTest();
    const s = await setup(undefined, storage);
    s.flush.mockResolvedValue(false);
    await expect(s.session.deleteEntry('/project/parts')).resolves.toBeInstanceOf(Error);
    expect(storage.removeWithHistory).not.toHaveBeenCalled();
  });
  it.each(['save', 'deletion'] as const)('does not attach history to a replacement project after a slow %s', async phase => {
    vi.useFakeTimers();
    const storage = storageForTest();
    const s = await setup(undefined, storage);
    const pending = Promise.withResolvers<undefined>();
    if (phase === 'save') s.flush.mockImplementation(async () => {
      await pending.promise;
      return true;
    });else vi.mocked(storage.removeWithHistory).mockImplementation(async () => {
      await pending.promise;
      return {
        undo: vi.fn(async () => {}),
        redo: vi.fn(async () => {})
      };
    });
    try {
      const deleting = s.session.deleteEntry('/project/parts');
      await vi.advanceTimersByTimeAsync(7_000);
      s.session.setProject(createProject().project);
      pending.resolve(undefined);
      await expect(deleting).resolves.toBeUndefined();
      if (phase === 'save') expect(storage.removeWithHistory).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects a path in a neighboring project before flushing or deleting', async () => {
    const storage = storageForTest();
    const s = await setup(undefined, storage);
    await expect(s.session.deleteEntry('/project-other/main.kcl')).resolves.toBeInstanceOf(Error);
    expect(s.flush).not.toHaveBeenCalled();
    expect(storage.removeWithHistory).not.toHaveBeenCalled();
  });
});
