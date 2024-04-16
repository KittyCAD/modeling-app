import { InitOutput, ServerConfig } from 'wasm-lib/pkg/wasm_lib'
import { FromServer, IntoServer } from './codec'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { copilotLspRun, initPromise, kclLspRun } from 'lang/wasm'
import { engineCommandManager } from 'lib/singletons'

export default class Server {
  readonly initOutput: InitOutput
  readonly #intoServer: IntoServer
  readonly #fromServer: FromServer

  private constructor(
    initOutput: InitOutput,
    intoServer: IntoServer,
    fromServer: FromServer
  ) {
    this.initOutput = initOutput
    this.#intoServer = intoServer
    this.#fromServer = fromServer
  }

  static async initialize(
    intoServer: IntoServer,
    fromServer: FromServer
  ): Promise<Server> {
    const initOutput = await initPromise
    const server = new Server(initOutput, intoServer, fromServer)
    return server
  }

  async start(type_: 'kcl' | 'copilot', token?: string): Promise<void> {
    const config = new ServerConfig(
      this.#intoServer,
      this.#fromServer,
      fileSystemManager
    )
    if (!token || token === '') {
      throw new Error(
        type_ + ': auth token is required for lsp server to start'
      )
    }
    if (type_ === 'copilot') {
      await copilotLspRun(config, token)
    } else if (type_ === 'kcl') {
      await kclLspRun(config, engineCommandManager, token || '')
    }
  }
}
