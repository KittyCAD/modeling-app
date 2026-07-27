// This filesystem derives its functions from NodeJS.
// This is primarily used for unit tests.
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import noopfs from '@src/lib/fs-zds/noopfs'

import fs from 'node:fs/promises'
import path from 'node:path'

const attach = async () => {}
const detach = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type NodeFSOptions = {}

const getPath: IZooDesignStudioFS['getPath'] = async (type) => {
  return path.sep + type
}

const makeCopiedPathWritable = async (targetPath: string): Promise<void> => {
  const stat = await fs.lstat(targetPath)
  if (stat.isSymbolicLink()) return

  await fs.chmod(targetPath, stat.mode | (stat.isDirectory() ? 0o700 : 0o600))
  if (!stat.isDirectory()) return

  for (const entryName of await fs.readdir(targetPath)) {
    await makeCopiedPathWritable(path.join(targetPath, entryName))
  }
}

export const cp: IZooDesignStudioFS['cp'] = async (
  sourcePath,
  targetPath,
  options
) => {
  const { makeWritable, ...copyOptions } = options ?? {}
  if (makeWritable === true && (await fs.lstat(sourcePath)).isSymbolicLink()) {
    return Promise.reject(
      new Error('Cannot duplicate a project whose root is a symbolic link')
    )
  }
  await fs.cp(sourcePath, targetPath, copyOptions)
  if (makeWritable === true) {
    if ((await fs.lstat(targetPath)).isSymbolicLink()) {
      await fs.rm(targetPath, { force: true })
      return Promise.reject(
        new Error('Cannot duplicate a project whose root is a symbolic link')
      )
    }
    await makeCopiedPathWritable(targetPath)
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
    cp,
    readFile: fs.readFile,
    rename: fs.rename,
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
