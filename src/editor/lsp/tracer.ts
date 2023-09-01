import * as LSP from 'vscode-languageserver-protocol'

var env = process.env.NODE_ENV || 'development'

export default class Tracer {
  static client(message: string): void {
    // These are really noisy, so we have a special env var for them.
    if (env === 'lsp_tracing') {
      console.log('lsp client message', message)
    }
  }

  static server(input: string | LSP.Message): void {
    // These are really noisy, so we have a special env var for them.
    if (env === 'lsp_tracing') {
      const message: string =
        typeof input === 'string' ? input : JSON.stringify(input)
      console.log('lsp server message', message)
    }
  }
}
