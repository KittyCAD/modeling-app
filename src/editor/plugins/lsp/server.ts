import { InitOutput, ServerConfig } from 'wasm-lib/pkg/wasm_lib'
import { FromServer, IntoServer } from './codec'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { copilotLspRun, initPromise, kclLspRun } from 'lang/wasm'

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
    if (type_ === 'copilot') {
      if (!token || token === '') {
        throw new Error('auth token is required for copilot')
      }
      await copilotLspRun(config, token)
    } else if (type_ === 'kcl') {
      await kclLspRun(config, token || '')
    }
  }
}
