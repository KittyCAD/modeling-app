import fsZds from '@src/lib/fs-zds'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import {
  configureOpfsCloudLocalFileSystem,
  configureOpfsCloudSync,
  ensureOpfsCloudProjectLocallySynced,
  getOpfsCloudProjectMetadata,
  getOpfsCloudProjectMetadataIndex,
  getOpfsCloudProjectModifiedTime,
  notifyOpfsCloudRemoveMutation,
  notifyOpfsCloudRenameMutation,
  notifyOpfsCloudWriteLikeMutation,
  opfsCloudSyncStatus,
  resolveOpfsCloudProjectConflict,
  retryOpfsCloudSync,
  setOpfsCloudSyncProjectScope,
} from '@src/lib/fs-zds/opfsCloud'
import type { OpfsCloudConflictResolution } from '@src/lib/fs-zds/opfsCloud'
import type {
  OPFSCloudConfig,
  OPFSCloudSyncStatus,
  OpfsCloudProjectMetadataIndexEntry,
  ProjectMetadata,
} from '@src/lib/fs-zds/opfsCloud/types'

export type CloudSyncConflictResolution = OpfsCloudConflictResolution
export type CloudSyncConfig = OPFSCloudConfig
export type CloudSyncStatus = OPFSCloudSyncStatus
export type CloudSyncProjectMetadata = ProjectMetadata
export type CloudSyncProjectMetadataIndexEntry =
  OpfsCloudProjectMetadataIndexEntry

let fsObserverInstalled = false

function bindLocalFileSystem(activeFs: IZooDesignStudioFS): IZooDesignStudioFS {
  return {
    resolve: activeFs.resolve.bind(activeFs),
    join: activeFs.join.bind(activeFs),
    relative: activeFs.relative.bind(activeFs),
    extname: activeFs.extname.bind(activeFs),
    sep: activeFs.sep,
    basename: activeFs.basename.bind(activeFs),
    dirname: activeFs.dirname.bind(activeFs),
    getPath: activeFs.getPath.bind(activeFs),
    access: activeFs.access.bind(activeFs),
    cp: activeFs.cp.bind(activeFs),
    readFile: activeFs.readFile.bind(
      activeFs
    ) as IZooDesignStudioFS['readFile'],
    rename: activeFs.rename.bind(activeFs),
    writeFile: activeFs.writeFile.bind(activeFs),
    readdir: activeFs.readdir.bind(activeFs),
    stat: activeFs.stat.bind(activeFs),
    mkdir: activeFs.mkdir.bind(activeFs),
    rm: activeFs.rm.bind(activeFs),
    detach: activeFs.detach.bind(activeFs),
    attach: activeFs.attach.bind(activeFs),
  }
}

export function installCloudSyncFileSystemObserver(
  activeFs: IZooDesignStudioFS = fsZds
) {
  if (fsObserverInstalled) {
    return
  }

  const localFs = bindLocalFileSystem(activeFs)
  configureOpfsCloudLocalFileSystem(localFs)

  const writeFile: IZooDesignStudioFS['writeFile'] = async (
    targetPath,
    data,
    options
  ) => {
    const result = await localFs.writeFile(targetPath, data, options)
    await notifyOpfsCloudWriteLikeMutation(targetPath)
    return result
  }
  const mkdir: IZooDesignStudioFS['mkdir'] = async (targetPath, options) => {
    const result = await localFs.mkdir(targetPath, options)
    await notifyOpfsCloudWriteLikeMutation(targetPath)
    return result
  }
  const cp: IZooDesignStudioFS['cp'] = async (
    sourcePath,
    targetPath,
    options
  ) => {
    const result = await localFs.cp(sourcePath, targetPath, options)
    await notifyOpfsCloudWriteLikeMutation(targetPath)
    return result
  }
  const rm: IZooDesignStudioFS['rm'] = async (targetPath, options) => {
    const result = await localFs.rm(targetPath, options)
    await notifyOpfsCloudRemoveMutation(targetPath)
    return result
  }
  const rename: IZooDesignStudioFS['rename'] = async (
    sourcePath,
    targetPath,
    options
  ) => {
    const result = await localFs.rename(sourcePath, targetPath, options)
    await notifyOpfsCloudRenameMutation(sourcePath, targetPath)
    return result
  }

  Object.assign(activeFs, {
    writeFile,
    mkdir,
    cp,
    rm,
    rename,
  })
  fsObserverInstalled = true
}

export function configureCloudSync(config: CloudSyncConfig) {
  if (config.enabled) {
    installCloudSyncFileSystemObserver()
  }

  configureOpfsCloudSync(config)
}

export const cloudSyncStatus = opfsCloudSyncStatus
export const retryCloudSync = retryOpfsCloudSync
export const setCloudSyncProjectScope = setOpfsCloudSyncProjectScope
export const ensureCloudProjectLocallySynced =
  ensureOpfsCloudProjectLocallySynced
export const getCloudSyncProjectMetadata = getOpfsCloudProjectMetadata
export const getCloudSyncProjectMetadataIndex = getOpfsCloudProjectMetadataIndex
export const getCloudSyncProjectModifiedTime = getOpfsCloudProjectModifiedTime
export const resolveCloudSyncProjectConflict = resolveOpfsCloudProjectConflict
