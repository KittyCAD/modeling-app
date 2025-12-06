import { IZooDesignStudioFS } from './interface'
import noopfs, { NoopFSOptions } from './noopfs'
import electronfs, { ElectronFSOptions } from './electronfs'
import opfs, { OPFSOptions } from './opfs'

function isAnFsBacking(x: unknown): x is IZooDesignStudioFS {
  return (
    typeof x === 'object' &&
    x !== null &&
    'detach' in x &&
    'attach' in x &&
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
  OPFS = 'opfs',
  ElectronFS = 'electronfs',
}

const STORAGE_IMPL: Record<StorageName, IZooDesignStudioFS> = {
  [StorageName.NoopFS]: noopfs.impl,
  [StorageName.OPFS]: opfs.impl,
  [StorageName.ElectronFS]: electronfs.impl,
}

export type StorageBacking =
  | { type: StorageName.NoopFS; options: NoopFSOptions }
  | { type: StorageName.OPFS; options: OPFSOptions }
  | { type: StorageName.ElectronFS; options: ElectronFSOptions }

// We must assign an object to this variable, and not undefined, because this
// object will act as a reference to all modules that import it. This reference
// will be further modified to give the necessary functionality.
const _impl: IZooDesignStudioFS = noopfs.impl

export const useFsViaObject = async (
  backing: StorageBacking
): Promise<IZooDesignStudioFS> => {
  return STORAGE_IMPL[backing.type]
}

export const useFsViaModuleImport = async (backing: StorageBacking) => {
  if (isAnFsBacking(_impl)) {
    await _impl.detach()
  }

  const impl = await useFsViaObject(backing)

  // Do not destroy the reference, but instead, reassign some of its properties.
  Object.assign(_impl, impl)

  // ts can't know if this is actually an fs backing even right after the
  // assignment, because _impl may have other properties.
  if (isAnFsBacking(_impl)) {
    await _impl.attach()
  }

  // Do not return the object to be potentially misused by consumers.
  // If you want it, use `useFsViaObject` instead.
}

// This reference is modified by `useFsViaModuleImport`, to support using fs
// functions like a developer normally would when dealing with a nodejs
// program.
export default _impl
