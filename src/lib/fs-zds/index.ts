import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import noopfs, { type NoopFSOptions } from '@src/lib/fs-zds/noopfs'
import electronfs, { type ElectronFSOptions } from '@src/lib/fs-zds/electronfs'
import opfs, { type OPFSOptions } from '@src/lib/fs-zds/opfs'

declare global {
  interface Window {
    fsZds: IZooDesignStudioFS
  }
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

export const moduleFsViaObject = async (
  backing: StorageBacking
): Promise<IZooDesignStudioFS> => {
  return STORAGE_IMPL[backing.type]
}

export const moduleFsViaWindow = async (backing: StorageBacking) => {
  window['fsZds'] = STORAGE_IMPL[backing.type]
}

export const moduleFsViaModuleImport = async (backing: StorageBacking) => {
  const impl = await moduleFsViaObject(backing)

  // Do not destroy the reference, but instead, reassign some of its properties.
  Object.assign(_impl, impl)

  // Do not return the object to be potentially misused by consumers.
  // If you want it, use `moduleFsViaObject` instead.
}

// This reference is modified by `moduleFsViaModuleImport`, to support using fs
// functions like a developer normally would when dealing with a nodejs
// program.
export default _impl
