import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

export interface FileOperationsMount {
  readonly root: string
  readonly operations: FileOperationsRegistryService
}

/** Routes by captured paths, never by the currently selected project. */
export function createMountedFileOperations(
  local: FileOperationsRegistryService,
  paths: Pick<
    IZooDesignStudioFS,
    'resolve' | 'relative' | 'sep' | 'join' | 'dirname'
  >
) {
  const mounts = new Map<string, FileOperationsMount>()
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
  const copyAcross = async (
    source: string,
    destination: string,
    overwrite = true
  ): Promise<void> => {
    const from = find(source)
    const to = find(destination)
    const stat = await from.stat(source)
    if (stat.kind === 'directory') {
      if (!(await to.exists(destination))) await to.createDirectory(destination)
      else if (!overwrite)
        return Promise.reject(new Error('Copy destination already exists.'))
      for (const name of await from.readDirectory(source)) {
        await copyAcross(
          paths.join(source, name),
          paths.join(destination, name),
          overwrite
        )
      }
    } else {
      const bytes = await from.readFile(source)
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
      ).reduce((a, b) => a + b, 0),
    stat: (path) => find(path).stat(path),
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
    remove: (path) => find(path).remove(path),
    copy: (source, destination, options) =>
      find(source) === find(destination)
        ? find(source).copy(source, destination, options)
        : copyAcross(source, destination, options?.overwrite ?? true),
    move: async (source, destination) => {
      const from = find(source)
      const to = find(destination)
      if (from === to) return from.move(source, destination)
      await copyAcross(source, destination, false)
      await from.remove(source)
    },
    rename: (source, destination) =>
      find(source) === find(destination)
        ? find(source).rename(source, destination)
        : Promise.reject(
            new Error('Rename cannot cross project storage backends; use move.')
          ),
  }
  return {
    operations,
    mount: (mount: FileOperationsMount) => {
      const root = paths.resolve(mount.root)
      mounts.set(root, { ...mount, root })
      return () => mounts.delete(root)
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
