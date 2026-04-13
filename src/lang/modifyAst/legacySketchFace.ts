import type { Node } from '@rust/kcl-lib/bindings/Node'

import { findUniqueName } from '@src/lang/create'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import { getNodeFromPath } from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  PathToNode,
  Program,
  VariableDeclarator,
} from '@src/lang/wasm'
import { parse, resultIsOk } from '@src/lang/wasm'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selection } from '@src/machines/modelingSharedTypes'

/**
 * Temporary legacy-compat helper for sketch solve.
 *
 * This creates a new sketch block directly in source for a legacy
 * `startSketchOn(...)` / `extrude(...)` flow instead of asking the Rust
 * frontend to derive it from a selected wall. Once sketch V1 is removed, this
 * helper and its call sites should be deleted.
 */
export function sketchBlockOnExtrudedFace(
  node: Node<Program>,
  faceSelection: Selection,
  extrudePathToNode: PathToNode,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): { modifiedAst: Node<Program>; pathToNode: PathToNode } | Error {
  let _node = { ...node }
  const sketchPathToNode = faceSelection.codeRef.pathToNode
  const newSketchName = findUniqueName(
    node,
    KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH
  )

  const oldSketchDeclarator = getNodeFromPath<VariableDeclarator>(
    _node,
    sketchPathToNode,
    wasmInstance,
    'VariableDeclarator',
    true
  )
  if (err(oldSketchDeclarator)) return oldSketchDeclarator
  const oldSketchName = oldSketchDeclarator.node.id.name

  const extrudeDeclarator = getNodeFromPath<VariableDeclarator>(
    _node,
    extrudePathToNode,
    wasmInstance,
    'VariableDeclarator'
  )
  if (err(extrudeDeclarator)) return extrudeDeclarator
  const extrudeName = extrudeDeclarator.node.id?.name

  const taggedSource = modifyAstWithTagsForSelection(
    _node,
    faceSelection,
    artifactGraph,
    wasmInstance
  )
  if (err(taggedSource)) return taggedSource
  _node = taggedSource.modifiedAst
  const [tagExpr] = taggedSource.exprs
  if (!tagExpr) {
    return new Error('Failed to create a face tag for the selected face.')
  }
  if (tagExpr.type !== 'Name') {
    return new Error(
      'Expected selected legacy face to resolve to a direct tag reference.'
    )
  }

  const sketchBlockCode = `${newSketchName} = sketch(on = faceOf(${
    extrudeName ? extrudeName : oldSketchName
  }, face = ${tagExpr.name.name})) {
}`
  const sketchBlockParse = parse(sketchBlockCode, wasmInstance)
  if (err(sketchBlockParse)) return sketchBlockParse
  if (!resultIsOk(sketchBlockParse)) {
    return new Error('Failed to parse generated sketch block.')
  }

  const [newSketchBlock] = sketchBlockParse.program.body
  if (!newSketchBlock) {
    return new Error('Failed to generate a sketch block.')
  }

  const expressionIndex = Math.max(
    sketchPathToNode[1][0] as number,
    extrudePathToNode[1][0] as number,
    node.body.length - 1
  )
  _node.body.splice(expressionIndex + 1, 0, newSketchBlock)

  return {
    modifiedAst: _node,
    pathToNode: [
      ['body', ''],
      [expressionIndex + 1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
    ],
  }
}
