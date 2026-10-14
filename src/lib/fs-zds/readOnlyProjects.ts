import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

export interface ProjectSnapshotFile {
  relativePath: string
  data: Uint8Array
}

/** Viewer caches are never writable through the application's filesystem. */
export function createReadOnlyProjectStorage(
  backing: IZooDesignStudioFS,
  root: string
) {
  const snapshots = new Set<string>()
  const contains = (parent: string, path: string) => {
    const relative = backing.relative(parent, path)
    return (
      relative === '' ||
      (relative !== '..' &&
        !relative.startsWith(`..${backing.sep}`) &&
        !relative.startsWith(backing.sep) &&
        !/^[a-zA-Z]:/.test(relative))
    )
  }
  const isReadOnly = (path: string) => contains(root, path)
  const assertWritable = (path: string, includesChildren = false) => {
    if (isReadOnly(path) || (includesChildren && contains(path, root))) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw Object.assign(new Error('This project is view-only.'), {
        code: 'EACCES',
      })
    }
  }
  const filesystem: IZooDesignStudioFS = {
    ...backing,
    writeFile: async (path, data, options) => {
      assertWritable(path)
      return backing.writeFile(path, data, options)
    },
    mkdir: async (path, options) => {
      assertWritable(path)
      return backing.mkdir(path, options)
    },
    rm: async (path, options) => {
      assertWritable(path, true)
      return backing.rm(path, options)
    },
    rename: async (source, destination, options) => {
      assertWritable(source, true)
      assertWritable(destination, true)
      return backing.rename(source, destination, options)
    },
    cp: async (source, destination, options) => {
      assertWritable(destination, true)
      return backing.cp(source, destination, options)
    },
  }

  return {
    filesystem,
    isReadOnly,
    async disposeSnapshot(path: string) {
      if (!snapshots.has(path)) return
      await backing.rm(path, { recursive: true, force: true })
      snapshots.delete(path)
    },
    async createSnapshot(files: readonly ProjectSnapshotFile[]) {
      const path = backing.join(root, crypto.randomUUID())
      const targets = files.map((file) =>
        backing.resolve(path, file.relativePath)
      )
      if (
        targets.some((target) => !contains(path, target) || target === path)
      ) {
        return Promise.reject(new Error('Invalid project file path.'))
      }
      try {
        for (const file of files) {
          const target = backing.resolve(path, file.relativePath)
          await backing.mkdir(backing.dirname(target), { recursive: true })
          await backing.writeFile(target, Uint8Array.from(file.data))
        }
      } catch (error) {
        await backing.rm(path, { recursive: true, force: true })
        return Promise.reject(error)
      }
      snapshots.add(path)
      return path
    },
  }
}
