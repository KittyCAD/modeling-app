// This filesystem derives its functions from NodeJS.
// This is primarily used for unit tests.
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import noopfs from '@src/lib/fs-zds/noopfs'
import {
  isAlreadyExistsError,
  PUBLISH_DIRECTORY_DESTINATION_EXISTS,
} from '@src/lib/fs-zds/errors'

import fs from 'node:fs/promises'
import path from 'node:path'

const attach = async () => {}
const detach = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type NodeFSOptions = {}

const getPath: IZooDesignStudioFS['getPath'] = async (type) => {
  return path.sep + type
}

const publishDirectory: IZooDesignStudioFS['publishDirectory'] = async (
  sourcePath,
  targetPath,
  inProgressMarkerName
) => {
  // A non-recursive mkdir is the portable Node primitive that atomically
  // reserves a previously absent directory. In particular, rename cannot be
  // used here: on macOS it replaces an existing empty destination directory.
  try {
    await fs.mkdir(targetPath)
  } catch (error) {
    return Promise.reject(
      isAlreadyExistsError(error) ? PUBLISH_DIRECTORY_DESTINATION_EXISTS : error
    )
  }

  const markerPath = path.join(targetPath, inProgressMarkerName)
  try {
    await fs.writeFile(markerPath, new Uint8Array(), { flag: 'wx' })
  } catch (error) {
    // Do not delete by pathname: another process could have replaced the
    // reservation after mkdir. No content copy starts without the marker, so
    // a markerless failure can leave only an empty quarantined directory.
    return Promise.reject(error)
  }

  for (const entryName of await fs.readdir(sourcePath)) {
    if (entryName === inProgressMarkerName) {
      continue
    }
    await fs.cp(
      path.join(sourcePath, entryName),
      path.join(targetPath, entryName),
      {
        recursive: true,
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
      }
    )
  }
}

let impl: IZooDesignStudioFS = noopfs.impl
if (typeof process !== 'undefined' && process.title !== 'browser') {
  impl = {
    resolve: path.resolve.bind(path),
    join: path.join.bind(path),
    relative: path.relative.bind(path),
    extname: path.extname.bind(path),
    sep: path.sep,
    basename: path.basename.bind(path),
    dirname: path.dirname.bind(path),
    getPath,
    access: fs.access,
    cp: fs.cp,
    readFile: fs.readFile,
    rename: fs.rename,
    publishDirectory,
    writeFile: fs.writeFile,
    readdir: fs.readdir,
    stat: fs.stat,
    mkdir: fs.mkdir,
    rm: fs.rm,
    detach,
    attach,
  }
}

export default {
  impl,
}
