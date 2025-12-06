// A no-op FS. Does nothing!
import { IZooDesignStudioFS } from './interface'

const noopAsync = async (..._args: any[]) => Promise.reject()
export type NoopFSOptions = {}

const impl: IZooDesignStudioFS = {
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
  impl
}
