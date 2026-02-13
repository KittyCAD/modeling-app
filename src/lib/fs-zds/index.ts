import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import noopfs, { type NoopFSOptions } from '@src/lib/fs-zds/noopfs'

function isAnFsBacking(x: unknown): x is IZooDesignStudioFS {
  return (
    typeof x === 'object' &&
    x !== null &&
    'detach' in x &&
    'attach' in x &&
    'getPath' in x &&
    'copyFile' in x &&
    'cp' in x &&
    'readFile' in x &&
    'existsSync' in x &&
    'rename' in x &&
    'writeFile' in x &&
    'readdir' in x &&
    'stat' in x &&
    'mkdir' in x &&
    'rm' in x
  )
}

export enum StorageName {
  NoopFS = 'noopfs',
}

const STORAGE_IMPL: Record<StorageName, IZooDesignStudioFS> = {
  [StorageName.NoopFS]: noopfs.impl,
}

export type StorageBacking = {
  type: StorageName.NoopFS
  options: NoopFSOptions
}

// We must assign an object to this variable, and not undefined, because this
// object will act as a reference to all modules that import it. This reference
// will be further modified to give the necessary functionality.
const _impl: IZooDesignStudioFS = noopfs.impl

export const moduleFsViaObject = async (
  backing: StorageBacking
): Promise<IZooDesignStudioFS> => {
  return STORAGE_IMPL[backing.type]
}

export const moduleFsViaModuleImport = async (backing: StorageBacking) => {
  if (isAnFsBacking(_impl)) {
    await _impl.detach()
  }

  const impl = await moduleFsViaObject(backing)

  // Do not destroy the reference, but instead, reassign some of its properties.
  Object.assign(_impl, impl)

  // ts can't know if this is actually an fs backing even right after the
  // assignment, because _impl may have other properties.
  if (isAnFsBacking(_impl)) {
    await _impl.attach()
  }

  // Do not return the object to be potentially misused by consumers.
  // If you want it, use `moduleFsViaObject` instead.
}

// This reference is modified by `moduleFsViaModuleImport`, to support using fs
// functions like a developer normally would when dealing with a nodejs
// program.
/**
 * A swappable adapter for most operations provided by NodeJS's `fs` and `path` modules.
 * In the web app these functions will call into operations on OPFS browser storage.
 * In the desktop app they will call into the NodeJS implementations.
 */
export default _impl
