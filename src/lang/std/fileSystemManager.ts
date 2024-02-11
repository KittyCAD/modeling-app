import { readBinaryFile } from '@tauri-apps/api/fs'

function readFile(path: string): Promise<Uint8Array> {
  return readBinaryFile(path)
}
