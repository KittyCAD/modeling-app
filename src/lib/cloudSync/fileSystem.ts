import { pathLockRequirements } from '@src/lib/fileSystem/pathLocking'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

type CloudSyncLocalFileSystem = IZooDesignStudioFS & {
  updateFile: (
    path: string,
    update: (contents: string) => string
  ) => Promise<boolean>
}

// The observer and sync engine must share these locks, including across tabs.
// Ancestor locks also exclude directory moves and removals during an update.
export function coordinateCloudSyncFileSystem(backing: IZooDesignStudioFS) {
  const coordinate = <T>(
    paths: string[],
    operation: () => Promise<T>,
    mode: 'shared' | 'exclusive' = 'exclusive'
  ) => {
    const requirements = pathLockRequirements(backing, paths, mode)
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    const acquire = (index: number): Promise<T> => {
      const requirement = requirements[index]
      if (!locks || !requirement) return operation()
      return locks.request(
        `zds-cloud-file:${requirement.path}`,
        { mode: requirement.mode },
        () => acquire(index + 1)
      )
    }
    return acquire(0)
  }

  function readFile(
    path: string,
    options: { encoding: 'utf-8' }
  ): Promise<string>
  function readFile(path: string, options: 'utf8'): Promise<string>
  function readFile(path: string): Promise<Uint8Array>
  function readFile(
    path: string,
    options?: unknown
  ): Promise<string | Uint8Array> {
    return coordinate<string | Uint8Array>(
      [path],
      () =>
        options === 'utf8' ||
        (typeof options === 'object' &&
          options !== null &&
          'encoding' in options)
          ? backing.readFile(path, { encoding: 'utf-8' })
          : backing.readFile(path),
      'shared'
    )
  }

  const coordinated: CloudSyncLocalFileSystem = {
    ...backing,
    access: (...args) => backing.access(...args),
    stat: (...args) => backing.stat(...args),
    readdir: (...args) => backing.readdir(...args),
    readFile,
    writeFile: (path, data, options) =>
      coordinate([path], () => backing.writeFile(path, data, options)),
    mkdir: (path, options) =>
      coordinate([path], () => backing.mkdir(path, options)),
    rm: (path, options) => coordinate([path], () => backing.rm(path, options)),
    cp: (source, target, options) =>
      coordinate([source, target], async () =>
        backing.cp(source, target, options)
      ),
    rename: (source, target, options) =>
      coordinate([source, target], () =>
        backing.rename(source, target, options)
      ),
    updateFile: (path, update) => {
      if (typeof navigator === 'undefined' || !navigator.locks) {
        return Promise.reject(
          new Error('Updating cloud project metadata requires Web Locks')
        )
      }
      return coordinate([path], async () => {
        const contents = await backing.readFile(path, { encoding: 'utf-8' })
        const next = update(contents)
        if (next === contents) return false
        await backing.writeFile(path, new TextEncoder().encode(next))
        return true
      })
    },
  }
  return coordinated
}
