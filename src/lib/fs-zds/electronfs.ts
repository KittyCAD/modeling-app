// This filesystem derives its functions from the electron boundary.
// Really, they are nodejs functions, but can only be accessed this way.
import { IZooDesignStudioFS } from './interface'

const attach = async () => {}
const detach = async () => {}

export type ElectronFSOptions = {}

// trust me
const impl: IZooDesignStudioFS = {
  cp: window.electron?.cp,
  readFile: window.electron?.readFile,
  rename: window.electron?.rename,
  writeFile: window.electron?.writeFile,
  readdir: window.electron?.readdir,
  stat: window.electron?.stat,
  mkdir: window.electron?.mkdir,
  rm: window.electron?.rm,
  detach,
  attach,
}

export default {
  impl,
}
