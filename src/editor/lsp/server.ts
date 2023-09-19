import init, {
  InitOutput,
  lsp_run,
  ServerConfig,
} from '../../wasm-lib/pkg/wasm_lib'
import { FromServer, IntoServer } from './codec'

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
    const initOutput = await init()
    const server = new Server(initOutput, intoServer, fromServer)
    return server
  }

  async start(): Promise<void> {
    const config = new ServerConfig(this.#intoServer, this.#fromServer)
    await lsp_run(config)
  }
}
