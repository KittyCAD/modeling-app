import type { Message } from 'vscode-languageserver-protocol'

export default class Tracer {
  static client(message: string): void {
    console.log('lsp client message', message)
  }

  static server(input: string | Message): void {
    const message: string =
      typeof input === 'string' ? input : JSON.stringify(input)
    console.log('lsp server message', message)
  }
}
