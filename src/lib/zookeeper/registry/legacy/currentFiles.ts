import type { KittyCadLibFile } from '@src/lib/zookeeper/zookeeperPromptRequest'
import type { FileMeta } from '@src/lib/types'

export function encodeLegacyProjectFiles(files: readonly FileMeta[]) {
  return encodeLegacyCurrentFiles(
    files.map((file) => ({
      name: file.relPath,
      data:
        file.type === 'other'
          ? file.data
          : new Blob([file.fileContents], { type: 'text/kcl' }),
    }))
  )
}

/** Legacy Zookeeper reads project contents from the request's current_files. */
export async function encodeLegacyCurrentFiles(
  files: readonly KittyCadLibFile[]
): Promise<Record<string, number[]>> {
  const currentFiles: Record<string, number[]> = {}
  for (const file of files) {
    currentFiles[file.name] = Array.from(
      new Uint8Array(await file.data.arrayBuffer())
    )
  }
  return currentFiles
}
