import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
import { ensureDirectory } from '@src/lib/fileSystem/ensureDirectory'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

export interface FileOperationsMount {
  readonly root: string
  readonly operations: FileOperationsRegistryService
  readonly batch?: <T>(
    path: string,
    run: (operations: FileOperationsRegistryService) => Promise<T>
  ) => Promise<T>
}

/** Routes captured paths through non-nested mounts, never the selected project. */
export function createMountedFileOperations(
  local: FileOperationsRegistryService,
  paths: Pick<
    IZooDesignStudioFS,
    'resolve' | 'relative' | 'sep' | 'join' | 'dirname'
  >,
  contributions: () => readonly FileOperationsMount[] = () => []
) {
  const mounts = new Map<string, FileOperationsMount>()
  let previousContributions: readonly FileOperationsMount[] | undefined
  let unregisterContributions: (() => void)[] = []
  const syncContributions = () => {
    const next = contributions()
    if (next === previousContributions) return
    const previousMounts = new Map(mounts)
    for (const unregister of unregisterContributions) unregister()
    try {
      const registrations = next.map(mount)
      unregisterContributions = registrations
      previousContributions = next
    } catch (error) {
      mounts.clear()
      for (const [root, registration] of previousMounts)
        mounts.set(root, registration)
      // Reject invalid registration without leaving a partially installed routing table.
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw error
    }
  }
  const findMount = (path: string) => {
    syncContributions()
    const absolute = paths.resolve(path)
    return [...mounts.values()].find(
      (mount) =>
        getContainedRelativePath(paths, mount.root, absolute) !== undefined
    )
  }
  const find = (path: string): FileOperationsRegistryService => {
    return findMount(path)?.operations ?? local
  }

  const copyAcross = async (
    from: FileOperationsRegistryService,
    to: FileOperationsRegistryService,
    source: string,
    destination: string,
    overwrite = true
  ): Promise<void> => {
    const stat = await from.stat(source)
    if (stat.kind === 'directory') {
      if (!(await to.exists(destination))) await to.createDirectory(destination)
      else if (!overwrite)
        return Promise.reject(new Error('Copy destination already exists.'))
      for (const name of await from.readDirectory(source)) {
        await copyAcross(
          from,
          to,
          paths.join(source, name),
          paths.join(destination, name),
          overwrite
        )
      }
    } else {
      const bytes = await from.readFile(source)
      await ensureDirectory(to, paths.dirname(destination))
      if (overwrite) await to.writeFile(destination, bytes)
      else await to.createFile(destination, bytes)
    }
  }
  const operations: FileOperationsRegistryService = {
    pending: async () => {
      syncContributions()
      return (
        await Promise.all(
          [local, ...[...mounts.values()].map((m) => m.operations)].map((o) =>
            o.pending()
          )
        )
      ).reduce((a, b) => a + b, 0)
    },
    stat: (path, options) => find(path).stat(path, options),
    canReadWrite: (path) => find(path).canReadWrite(path),
    exists: (path) => find(path).exists(path),
    readDirectory: (path) => find(path).readDirectory(path),
    readFile: (path) => find(path).readFile(path),
    writeFile: (path, contents) => find(path).writeFile(path, contents),
    createFile: (path, contents) => find(path).createFile(path, contents),
    createUniqueFile: (parent, name, contents) =>
      find(parent).createUniqueFile(parent, name, contents),
    createDirectory: (path) => find(path).createDirectory(path),
    createUniqueDirectory: (parent, name) =>
      find(parent).createUniqueDirectory(parent, name),
    removeWithSnapshot: (path) => find(path).removeWithSnapshot(path),
    replayDeletion: (deletion, restore) =>
      find(deletion.path).replayDeletion(deletion, restore),
    remove: (path) => find(path).remove(path),
    copy: (source, destination, options) => {
      const from = find(source)
      const to = find(destination)
      return from === to
        ? from.copy(source, destination, options)
        : copyAcross(from, to, source, destination, options?.overwrite ?? true)
    },
    move: async (source, destination) => {
      const from = find(source)
      const to = find(destination)
      if (from === to) return from.move(source, destination)
      return Promise.reject(
        new Error(
          'Move cannot cross project storage backends; clone the project instead.'
        )
      )
    },
    rename: (source, destination) => {
      const from = find(source)
      const to = find(destination)
      if (from === to) return from.rename(source, destination)
      return Promise.reject(
        new Error(
          'Rename cannot cross project storage backends; clone the project instead.'
        )
      )
    },
  }
  const mount = (mount: FileOperationsMount) => {
    let root = paths.resolve(mount.root)
    for (const existing of mounts.values()) {
      const relative = getContainedRelativePath(paths, existing.root, root)
      if (relative === '') root = existing.root
      else if (
        relative !== undefined ||
        getContainedRelativePath(paths, root, existing.root) !== undefined
      ) {
        // Registration is synchronous; reject invalid configuration before changing routes.
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new Error('Nested filesystem mounts are not supported.')
      }
    }
    const registration = { ...mount, root }
    mounts.set(root, registration)
    return () => {
      if (mounts.get(root) === registration) mounts.delete(root)
    }
  }
  return {
    operations,
    mount,
    batch: <T>(
      path: string,
      run: (operations: FileOperationsRegistryService) => Promise<T>
    ) => {
      const backing = findMount(path)
      return backing?.batch ? backing.batch(path, run) : run(operations)
    },
  }
}

export type ProjectLocation =
  | { readonly type: 'cloud'; readonly id: string }
  | { readonly type: 'local'; readonly id: string }

/** Only a remote 404 establishes absence. Authentication/network errors propagate. */
export async function resolveProjectLocation(
  id: string,
  remoteExists: (id: string) => Promise<boolean>
): Promise<ProjectLocation> {
  if (id.startsWith('local:')) return { type: 'local', id: id.slice(6) }
  if (id.startsWith('cloud:')) return { type: 'cloud', id: id.slice(6) }
  return { type: (await remoteExists(id)) ? 'cloud' : 'local', id }
}
