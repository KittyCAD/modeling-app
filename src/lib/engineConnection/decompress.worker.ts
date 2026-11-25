import { decompress } from 'fzstd'

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const decoded = decompress(new Uint8Array(event.data))
    const data = new Uint8Array(decoded).buffer
    self.postMessage({ data }, { transfer: [data] })
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
