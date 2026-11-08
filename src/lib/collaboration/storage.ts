import { z } from 'zod'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import {
  FileNotFound,
  FileAlreadyExists,
} from '@src/lib/fileSystem/fileOperations'
import fsZds from '@src/lib/fs-zds'

/** The index retains unnamed drafts and maps source locators to stable document IDs. */
export const historyIndexSchema = z.array(
  z.object({
    id: z.string().regex(/^[a-zA-Z0-9]+$/),
    src: z.string().optional(),
    diskText: z.string(),
  })
)
export type HistoryEntry = z.infer<typeof historyIndexSchema>[number]

export function projectHistoryStorage(
  operations: FileOperationsRegistryService,
  root: string,
  writable: boolean
) {
  const directory = fsZds.join(root, '.zoo', 'automerge')
  const indexPath = fsZds.join(directory, 'index.json')
  let initialized: Promise<void> | undefined
  const initialize = () =>
    (initialized ??= (async () => {
      for (const path of [fsZds.join(root, '.zoo'), directory]) {
        try {
          await operations.createDirectory(path)
        } catch (error) {
          if (
            !(error instanceof FileAlreadyExists) ||
            (await operations.stat(path)).kind !== 'directory'
          )
            return Promise.reject(error)
        }
      }
      try {
        await operations.createFile(
          fsZds.join(root, '.zoo', '.gitignore'),
          '*\n'
        )
      } catch (error) {
        if (!(error instanceof FileAlreadyExists)) return Promise.reject(error)
      }
      // Also ignore history if .zoo already has a user-maintained ignore file.
      try {
        await operations.createFile(fsZds.join(directory, '.gitignore'), '*\n')
      } catch (error) {
        if (!(error instanceof FileAlreadyExists)) return Promise.reject(error)
      }
    })().catch((cause) => {
      initialized = undefined
      return Promise.reject(cause)
    }))
  return {
    writable,
    readIndex: async (): Promise<HistoryEntry[]> => {
      try {
        return historyIndexSchema.parse(
          JSON.parse(
            new TextDecoder().decode(await operations.readFile(indexPath))
          )
        )
      } catch (error) {
        if (error instanceof FileNotFound) return []
        return Promise.reject(error)
      }
    },
    read: (id: string) =>
      operations.readFile(fsZds.join(directory, `${id}.automerge`)),
    write: async (id: string, bytes: Uint8Array, index: HistoryEntry[]) => {
      if (!writable) return
      await initialize()
      // Publish the index after its document, so an index never references a missing first snapshot.
      await operations.writeFile(
        fsZds.join(directory, `${id}.automerge`),
        bytes
      )
      await operations.writeFile(
        indexPath,
        JSON.stringify(index, null, 2) + '\n'
      )
    },
  }
}
