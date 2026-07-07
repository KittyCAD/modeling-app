import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  notifyCloudSyncRemoveMutation,
  notifyCloudSyncRenameMutation,
  notifyCloudSyncWriteLikeMutation,
} from '@src/lib/cloudSync/engine'
import type { CloudSyncConfig } from '@src/lib/cloudSync/types'
import fsZds from '@src/lib/fs-zds'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

export * from '@src/lib/cloudSync/engine'
export { retryCloudSyncEngine as retryCloudSync } from '@src/lib/cloudSync/engine'
export type {
  CloudSyncConfig,
  CloudSyncProjectMetadataIndexEntry,
  CloudSyncStatus,
  ProjectMetadata as CloudSyncProjectMetadata,
} from '@src/lib/cloudSync/types'

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
    readFile: activeFs.readFile.bind(activeFs),
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
  configureCloudSyncLocalFileSystem(localFs)

  const writeFile: IZooDesignStudioFS['writeFile'] = async (
    targetPath,
    data,
    options
  ) => {
    const result = await localFs.writeFile(targetPath, data, options)
    await notifyCloudSyncWriteLikeMutation(targetPath)
    return result
  }
  const mkdir: IZooDesignStudioFS['mkdir'] = async (targetPath, options) => {
    const result = await localFs.mkdir(targetPath, options)
    await notifyCloudSyncWriteLikeMutation(targetPath)
    return result
  }
  const cp: IZooDesignStudioFS['cp'] = async (
    sourcePath,
    targetPath,
    options
  ) => {
    const result = await localFs.cp(sourcePath, targetPath, options)
    await notifyCloudSyncWriteLikeMutation(targetPath)
    return result
  }
  const rm: IZooDesignStudioFS['rm'] = async (targetPath, options) => {
    const result = await localFs.rm(targetPath, options)
    await notifyCloudSyncRemoveMutation(targetPath)
    return result
  }
  const rename: IZooDesignStudioFS['rename'] = async (
    sourcePath,
    targetPath,
    options
  ) => {
    const result = await localFs.rename(sourcePath, targetPath, options)
    await notifyCloudSyncRenameMutation(sourcePath, targetPath)
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

  configureCloudSyncEngine(config)
}
