import { posix } from 'path'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { addModuleImport } from '@src/lang/modifyAst'
import { addClone } from '@src/lang/modifyAst/transforms'
import type { ArtifactGraph, Program } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
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

/** Add another instance using the existing import when one is available. */
export function addImportOrClone({
  ast,
  path,
  localName,
  representation,
  artifactGraph,
  wasmInstance,
}: {
  ast: Node<Program>
  path: string
  localName: string
  representation?: 'mesh' | 'brep'
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
}) {
  const importedFile = findImportedFile(ast, path)
  if (!importedFile) {
    return addModuleImport({ ast, path, localName, representation })
  }
  if (
    importedFile.node.selector.type !== 'None' ||
    !importedFile.node.selector.alias
  ) {
    return new Error(
      'This file must be imported with a module alias to add a clone.'
    )
  }
  return addClone({
    ast,
    artifactGraph,
    objects: {
      graphSelections: [importedFile.selection],
      otherSelections: [],
    },
    variableName: localName,
    wasmInstance,
  })
}
