import { posix } from 'path'
import type { Program } from '@src/lang/wasm'
import type { Selection } from '@src/machines/modelingSharedTypes'

/** Match project-file imports even when KCL spells the path with ./ or .. segments. */
export function findImportedFile(ast: Program, filePath: string) {
  const normalizedPath = posix.normalize(filePath.replaceAll('\\', '/'))
  for (const [index, node] of ast.body.entries()) {
    if (node.type !== 'ImportStatement' || node.path.type === 'Std') continue
    const importedPath =
      node.path.type === 'Kcl' ? node.path.filename : node.path.path
    if (posix.normalize(importedPath.replaceAll('\\', '/')) !== normalizedPath)
      continue

    const selection: Selection = {
      codeRef: {
        range: [node.start, node.end, node.moduleId],
        pathToNode: [
          ['body', ''],
          [index, 'index'],
        ],
      },
    }
    return { node, selection }
  }
}
