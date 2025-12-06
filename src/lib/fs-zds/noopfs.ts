// A no-op FS. Does nothing!
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

const noopAsync = async (..._args: any[]) => Promise.reject()

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type NoopFSOptions = {}

const impl: IZooDesignStudioFS = {
  access: noopAsync,
  getPath: noopAsync,
  cp: noopAsync,
  readFile: noopAsync,
  rename: noopAsync,
  writeFile: noopAsync,
  readdir: noopAsync,
  stat: noopAsync,
  mkdir: noopAsync,
  rm: noopAsync,
  detach: noopAsync,
  attach: noopAsync,
}

export default {
  impl,
}
