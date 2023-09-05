import { Message } from 'vscode-languageserver-protocol'

const env = import.meta.env.MODE

export default class Tracer {
  static client(message: string): void {
    // These are really noisy, so we have a special env var for them.
    if (env === 'lsp_tracing') {
      console.log('lsp client message', message)
    }
  }

  static server(input: string | Message): void {
    // These are really noisy, so we have a special env var for them.
    if (env === 'lsp_tracing') {
      const message: string =
        typeof input === 'string' ? input : JSON.stringify(input)
      console.log('lsp server message', message)
    }
  }
}
