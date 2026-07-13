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

/**
 * Captures bound references to the active filesystem methods before cloud sync
 * installs its mutation observer. The observer wrappers call these delegates so
 * they can forward the original operation without recursively invoking
 * themselves.
 *
 * TODO: Replace this cloud-sync-owned filesystem augmentation with an `fs-zds`
 * mutation lifecycle/event API. See:
 * https://github.com/KittyCAD/modeling-app/issues/12361
 */
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

/**
 * Installs the transitional cloud sync filesystem observer.
 *
 * Today this augments the active `fs-zds` object by wrapping write-like methods
 * and reporting successful mutations to the cloud sync engine. Longer term,
 * `fs-zds` should own this lifecycle surface and cloud sync should subscribe to
 * it instead of replacing methods on the shared filesystem object.
 */
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

/**
 * Applies the current cloud sync runtime policy. Enabling cloud sync also
 * ensures the filesystem observer is installed so local mutations can enqueue
 * sync work.
 */
export function configureCloudSync(config: CloudSyncConfig) {
  if (config.enabled) {
    installCloudSyncFileSystemObserver()
  }

  configureCloudSyncEngine(config)
}
