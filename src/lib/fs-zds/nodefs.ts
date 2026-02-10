// This filesystem derives its functions from NodeJS.
// This is primarily used for unit tests.
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

import fs from 'node:fs/promise'
import path from 'node:path'

const attach = async () => {}
const detach = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type NodeFSOptions = {}

const getPath: IZooDesignStudioFS['getPath'] = async (type) => {
  return path.sep + type
}

const impl: IZooDesignStudioFS = {
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
  writeFile: fs.writeFile,
  readdir: fs.readdir,
  stat: fs.stat,
  mkdir: fs.mkdir,
  rm: fs.rm,
  detach,
  attach,
}

export default {
  impl,
}
