import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
  createLiteral,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import { buildSolidsAndFacesExprs } from '@src/lang/modifyAst/faces'
import type {
  ArtifactGraph,
  CallExpressionKw,
  PathToNode,
  Program,
  VariableDeclarator,
} from '@src/lang/wasm'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { addTagForSketchOnFace as AddTagForSketchOnFaceFn } from '@src/lang/std/sketch'
import type { ExtrudeFacePlane } from '@src/machines/modelingSharedTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selection } from '@src/machines/modelingSharedTypes'

/**
 * Materialize a concrete face reference before creating a sketch block.
 * Treatments, inherited faces and legacy sketch walls use this path when
 * the Rust frontend cannot derive the reference from the selected entity.
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
    wasmInstance,
    undefined,
    { artifactTypeFilter: ['sweep', 'compositeSolid'] }
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

export function sketchOnExtrudedFace(
  node: Node<Program>,
  sketchPathToNode: PathToNode,
  extrudePathToNode: PathToNode,
  addTagForSketchOnFace: typeof AddTagForSketchOnFaceFn,
  wasmInstance: ModuleType,
  info: ExtrudeFacePlane['faceInfo'] = { type: 'wall' },
  faceContext?: { faceId: string; artifactGraph: ArtifactGraph }
): { modifiedAst: Node<Program>; pathToNode: PathToNode } | Error {
  if (faceContext) {
    // Preserve the selected instance and its face reference, including pattern indices.
    const result = buildSolidsAndFacesExprs(
      {
        graphSelections: [
          { entityRef: { type: 'face', face_id: faceContext.faceId } },
        ],
        otherSelections: [],
      },
      faceContext.artifactGraph,
      node,
      wasmInstance,
      undefined,
      { artifactTypeFilter: ['sweep', 'compositeSolid'] }
    )
    if (err(result)) return result
    if (!result.solidsExpr || !result.facesExpr) {
      return new Error('Failed to resolve the selected sketch support face.')
    }
    const modifiedAst = result.modifiedAst
    const index = modifiedAst.body.length
    modifiedAst.body.push(
      createVariableDeclaration(
        findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH),
        createCallExpressionStdLibKw('startSketchOn', result.solidsExpr, [
          createLabeledArg('face', result.facesExpr),
        ])
      )
    )
    return {
      modifiedAst,
      pathToNode: [
        ['body', ''],
        [index, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', 'VariableDeclarator'],
      ],
    }
  }
  let _node = { ...node }
  const newSketchName = findUniqueName(
    node,
    KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH
  )
  const _node1 = getNodeFromPath<VariableDeclarator>(
    _node,
    sketchPathToNode,
    wasmInstance,
    'VariableDeclarator',
    true
  )
  if (err(_node1)) return _node1
  const { node: oldSketchNode } = _node1

  const oldSketchName = oldSketchNode.id.name
  const _node2 = getNodeFromPath<CallExpressionKw>(
    _node,
    sketchPathToNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (err(_node2)) return _node2
  const { node: expression } = _node2

  const _node3 = getNodeFromPath<VariableDeclarator>(
    _node,
    extrudePathToNode,
    wasmInstance,
    'VariableDeclarator'
  )
  if (err(_node3)) return _node3
  const { node: extrudeVarDec } = _node3
  const extrudeName = extrudeVarDec.id?.name

  let _tag
  if (info.type !== 'cap') {
    const __tag = addTagForSketchOnFace(
      {
        pathToNode: sketchPathToNode,
        node: _node,
        wasmInstance,
      },
      expression.callee.name.name,
      info.type === 'edgeCut' ? info : null,
      wasmInstance
    )
    if (err(__tag)) return __tag
    const { modifiedAst, tag } = __tag
    _tag = createLocalName(tag)
    _node = modifiedAst
  } else {
    const capCall = getNodeFromPath<CallExpressionKw>(
      _node,
      extrudePathToNode,
      wasmInstance,
      ['CallExpressionKw']
    )
    const capTagLabel = info.subType === 'end' ? 'tagEnd' : 'tagStart'
    const existingCapTag = err(capCall)
      ? undefined
      : capCall.node.arguments.find(
          (argument) => argument.label?.name === capTagLabel
        )?.arg
    _tag =
      existingCapTag?.type === 'TagDeclarator'
        ? createLocalName(existingCapTag.value)
        : createLiteral(info.subType.toUpperCase(), wasmInstance)
  }
  const newSketch = createVariableDeclaration(
    newSketchName,
    createCallExpressionStdLibKw(
      'startSketchOn',
      createLocalName(extrudeName ? extrudeName : oldSketchName),
      [createLabeledArg('face', _tag)]
    ),
    undefined,
    'const'
  )

  const expressionIndex = Math.max(
    sketchPathToNode[1][0] as number,
    extrudePathToNode[1][0] as number,
    node.body.length - 1
  )
  _node.body.splice(expressionIndex + 1, 0, newSketch)
  const newpathToNode: PathToNode = [
    ['body', ''],
    [expressionIndex + 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]

  return {
    modifiedAst: _node,
    pathToNode: newpathToNode,
  }
}
