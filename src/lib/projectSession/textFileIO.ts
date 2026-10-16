import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/** Text access and watch hooks shared by a project session's files and editors. */
export interface TextFileIO {
  readonly read: (path: string) => Promise<string>
  readonly modifiedAt: (path: string) => Promise<number>
  readonly write: (path: string, content: string) => Promise<void>
  readonly watch: (
    path: string,
    key: string,
    onEvent: (eventType: string, path: string) => void
  ) => void
  readonly unwatch: (path: string, key: string) => void
}

export function createTextFileIO(
  operations: Pick<
    FileOperationsRegistryService,
    'readFile' | 'writeFile' | 'stat'
  >,
  watcher: Pick<TextFileIO, 'watch' | 'unwatch'>
): TextFileIO {
  return {
    read: async (path) =>
      new TextDecoder().decode(await operations.readFile(path)),
    modifiedAt: async (path) => (await operations.stat(path)).modifiedAt,
    write: (path, content) => operations.writeFile(path, content),
    watch: (path, key, onEvent) => watcher.watch(path, key, onEvent),
    unwatch: (path, key) => watcher.unwatch(path, key),
  }
}
