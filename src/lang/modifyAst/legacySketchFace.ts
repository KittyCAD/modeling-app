import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import { buildSolidsAndFacesExprs } from '@src/lang/modifyAst/faces'
import type {
  ArtifactGraph,
  PathToNode,
  Program,
  VariableDeclarator,
} from '@src/lang/wasm'
import { getNodeFromPath } from '@src/lang/queryAst'
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
  sketchPathToNode: PathToNode,
  extrudePathToNode: PathToNode,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): { modifiedAst: Node<Program>; pathToNode: PathToNode } | Error {
  let modifiedAst = structuredClone(node)
  const newSketchName = findUniqueName(
    node,
    KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH
  )

  const result = buildSolidsAndFacesExprs(
    {
      graphSelections: [faceSelection],
      otherSelections: [],
    },
    artifactGraph,
    modifiedAst,
    wasmInstance
  )
  if (err(result)) return result

  const { solidsExpr, facesExpr } = result
  if (!solidsExpr || !facesExpr) {
    return new Error(
      'Failed to resolve solid and face expressions for selected face.'
    )
  }

  modifiedAst = result.modifiedAst

  const onExpr = createCallExpressionStdLibKw('faceOf', solidsExpr, [
    createLabeledArg('face', facesExpr),
  ])
  const newSketchBlock = createVariableDeclaration(newSketchName, {
    type: 'SketchBlock',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    arguments: [createLabeledArg('on', onExpr)],
    body: {
      type: 'Block',
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      items: [],
    },
  })

  const expressionIndex = Math.max(
    sketchPathToNode[1][0] as number,
    extrudePathToNode[1][0] as number,
    node.body.length - 1
  )
  modifiedAst.body.splice(expressionIndex + 1, 0, newSketchBlock)

  return {
    modifiedAst,
    pathToNode: [
      ['body', ''],
      [expressionIndex + 1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
    ],
  }
}

export function sketchBlockOnExtrudeCap(
  node: Node<Program>,
  extrudePathToNode: PathToNode,
  capKind: 'start' | 'end',
  wasmInstance: ModuleType
): { modifiedAst: Node<Program>; pathToNode: PathToNode } | Error {
  const modifiedAst = structuredClone(node)
  const newSketchName = findUniqueName(
    node,
    KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH
  )

  const extrudeNode = getNodeFromPath<VariableDeclarator>(
    modifiedAst,
    extrudePathToNode,
    wasmInstance,
    'VariableDeclarator'
  )
  if (err(extrudeNode)) return extrudeNode

  const extrudeName = extrudeNode.node.id?.name
  if (!extrudeName) {
    return new Error('Failed to resolve extrusion name for selected cap.')
  }

  const onExpr = createCallExpressionStdLibKw(
    'faceOf',
    createLocalName(extrudeName),
    [
      createLabeledArg(
        'face',
        createLocalName(capKind === 'start' ? 'START' : 'END')
      ),
    ]
  )
  const newSketchBlock = createVariableDeclaration(newSketchName, {
    type: 'SketchBlock',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    arguments: [createLabeledArg('on', onExpr)],
    body: {
      type: 'Block',
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      items: [],
    },
  })

  const expressionIndex = Math.max(
    extrudePathToNode[1][0] as number,
    node.body.length - 1
  )
  modifiedAst.body.splice(expressionIndex + 1, 0, newSketchBlock)

  return {
    modifiedAst,
    pathToNode: [
      ['body', ''],
      [expressionIndex + 1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
    ],
  }
}
