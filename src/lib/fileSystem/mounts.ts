import { ensureDirectory } from '@src/lib/fileSystem/ensureDirectory'
import {
  pathLockRequirements,
  type PathLockRequirement,
} from '@src/lib/fileSystem/pathLocking'
import type { FileContents } from '@src/lib/fileSystem/fileOperations'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

export interface FileOperationsMount {
  readonly root: string
  readonly operations: FileOperationsRegistryService
}

/**
 * Routes by captured paths, never by the currently selected project.
 * Project mutations must use this facade to coordinate with cross-backend transfers.
 */
export function createMountedFileOperations(
  local: FileOperationsRegistryService,
  paths: Pick<
    IZooDesignStudioFS,
    'resolve' | 'relative' | 'sep' | 'join' | 'dirname'
  >
) {
  const mounts = new Map<string, FileOperationsMount>()
  /**
   * Transfers retain their source and destination reservations through deletion.
   * Ordinary mutations keep using backend coordination, but cannot overlap a transfer.
   */
  const mutations = new Set<{
    readonly locks: readonly PathLockRequirement[]
    readonly transfer: boolean
    readonly finished: Promise<void>
  }>()
  let waiting = 0
  const coordinate = async <T>(
    targets: readonly string[],
    work: () => Promise<T>,
    transfer = false
  ): Promise<T> => {
    const locks = pathLockRequirements(paths, targets)
    const blockers = [...mutations].filter(
      (other) =>
        (transfer || other.transfer) &&
        locks.some((lock) =>
          other.locks.some(
            (held) =>
              held.path === lock.path &&
              (held.mode === 'exclusive' || lock.mode === 'exclusive')
          )
        )
    )
    let release = () => {}
    const finished = new Promise<void>((resolve) => {
      release = resolve
    })
    const reservation = { locks, transfer, finished }
    mutations.add(reservation)
    try {
      if (blockers.length) {
        waiting += 1
        await Promise.all(blockers.map((blocker) => blocker.finished))
        waiting -= 1
      }
      return await work()
    } finally {
      mutations.delete(reservation)
      release()
    }
  }
  const find = (path: string): FileOperationsRegistryService => {
    const absolute = paths.resolve(path)
    const mount = [...mounts.values()]
      .filter(
        ({ root }) =>
          absolute === root || absolute.startsWith(`${root}${paths.sep}`)
      )
      .sort((a, b) => b.root.length - a.root.length)[0]
    return mount?.operations ?? local
  }
  const mutate = <T>(
    path: string,
    work: (owner: FileOperationsRegistryService) => Promise<T>
  ) => {
    const owner = find(path)
    return coordinate([path], () => work(owner))
  }
  // A transfer can delay delegation, so take ownership at submission time.
  const ownContents = (contents: FileContents): FileContents =>
    typeof contents === 'string' ? contents : new Uint8Array(contents)
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
    pending: async () =>
      (
        await Promise.all(
          [local, ...[...mounts.values()].map((m) => m.operations)].map((o) =>
            o.pending()
          )
        )
      ).reduce((a, b) => a + b, 0) + waiting,
    stat: (path) => find(path).stat(path),
    canReadWrite: (path) => find(path).canReadWrite(path),
    exists: (path) => find(path).exists(path),
    readDirectory: (path) => find(path).readDirectory(path),
    readFile: (path) => find(path).readFile(path),
    writeFile: (path, contents) => {
      const owned = ownContents(contents)
      return mutate(path, (owner) => owner.writeFile(path, owned))
    },
    createFile: (path, contents) => {
      const owned = ownContents(contents)
      return mutate(path, (owner) => owner.createFile(path, owned))
    },
    createUniqueFile: (parent, name, contents) => {
      const owned = ownContents(contents)
      return mutate(parent, (owner) =>
        owner.createUniqueFile(parent, name, owned)
      )
    },
    createDirectory: (path) =>
      mutate(path, (owner) => owner.createDirectory(path)),
    createUniqueDirectory: (parent, name) =>
      mutate(parent, (owner) => owner.createUniqueDirectory(parent, name)),
    remove: (path) => mutate(path, (owner) => owner.remove(path)),
    copy: (source, destination, options) => {
      const from = find(source)
      const to = find(destination)
      return coordinate(
        [source, destination],
        () =>
          from === to
            ? from.copy(source, destination, options)
            : copyAcross(
                from,
                to,
                source,
                destination,
                options?.overwrite ?? true
              ),
        from !== to
      )
    },
    move: (source, destination) => {
      const from = find(source)
      const to = find(destination)
      return coordinate(
        [source, destination],
        async () => {
          if (from === to) return from.move(source, destination)
          await copyAcross(from, to, source, destination, false)
          await from.remove(source)
        },
        from !== to
      )
    },
    rename: (source, destination) => {
      const from = find(source)
      if (from !== find(destination))
        return Promise.reject(
          new Error('Rename cannot cross project storage backends; use move.')
        )
      return coordinate([source, destination], () =>
        from.rename(source, destination)
      )
    },
  }
  return {
    operations,
    mount: (mount: FileOperationsMount) => {
      const root = paths.resolve(mount.root)
      const registration = { ...mount, root }
      mounts.set(root, registration)
      return () => {
        if (mounts.get(root) === registration) mounts.delete(root)
      }
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
