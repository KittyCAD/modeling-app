// This filesystem derives its functions from the electron boundary.
// Really, they are nodejs functions, but can only be accessed this way.
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import noopfs from '@src/lib/fs-zds/noopfs'

const attach = async () => {}
const detach = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ElectronFSOptions = {}

// In a web worker context (which our wasm blob lives in and needs fs access),
// window is not available. Not even the variable name is.

const impl: IZooDesignStudioFS =
  typeof window === 'undefined' || window.electron === undefined
    ? noopfs.impl
    : {
        getPath: window.electron.getPath,
        access: window.electron.access,
        cp: window.electron.cp,
        readFile: window.electron.readFile,
        rename: window.electron.rename,
        writeFile: window.electron.writeFile,
        readdir: window.electron.readdir,
        stat: window.electron.stat,
        mkdir: window.electron.mkdir,
        rm: window.electron.rm,
        detach,
        attach,
      }

export default {
  impl,
}
