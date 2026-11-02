import type { Node } from '@rust/kcl-lib/bindings/Node'
import type {
  ArtifactCameraView,
  ArtifactPoint3d,
} from '@rust/kcl-lib/bindings/Artifact'
import type { Orientation } from '@rust/kcl-lib/bindings/Orientation'
import type { Projection } from '@rust/kcl-lib/bindings/Projection'
import type { Visibility } from '@rust/kcl-lib/bindings/Visibility'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import {
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type { ArtifactGraph, Expr, PathToNode, Program } from '@src/lang/wasm'
import { modelingStdLibCall } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import { capitaliseFC, roundOff } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

const CAPTURED_CAMERA_DECIMALS = 6

function viewEnum(type: string, value: string) {
  return createLocalName(value, [
    createIdentifier('view'),
    createIdentifier(type),
  ])
}

export function addNamedView({
  ast,
  artifactGraph,
  name,
  camera: capturedCamera,
  cameraMode = capturedCamera ? 'directed' : 'oriented',
  orientation,
  target,
  distance,
  projection,
  baseline,
  except,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  name: string
  camera?: NamedViewCameraInput
  cameraMode?: NamedViewCameraMode
  orientation?: Orientation
  target?: KclCommandValue
  distance?: KclCommandValue
  projection?: Projection
  baseline: Visibility
  except?: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const namedCall = modelingStdLibCall('Named View')

  const exceptVars =
    !mNodeToEdit && except
      ? getVariableExprsFromSelection(
          except,
          artifactGraph,
          modifiedAst,
          wasmInstance,
          undefined,
          { lastChildLookup: false }
        )
      : { exprs: [] }
  if (err(exceptVars)) {
    return exceptVars
  }

  let camera: Expr | undefined
  if (cameraMode === 'directed') {
    if (!capturedCamera) return new Error('Capture the current camera first.')
    camera =
      'type' in capturedCamera
        ? structuredClone(capturedCamera)
        : createCapturedCamera(capturedCamera, wasmInstance)
  } else if (orientation && projection) {
    camera = createCallExpressionStdLibKw(
      'oriented',
      viewEnum('Orientation', orientation),
      [
        ...(target
          ? [createLabeledArg('target', valueOrVariable(target))]
          : []),
        ...(distance
          ? [createLabeledArg('distance', valueOrVariable(distance))]
          : []),
        createLabeledArg('projection', viewEnum('Projection', projection)),
      ],
      undefined,
      [createIdentifier('view')]
    )
    if (target && 'variableName' in target && target.variableName) {
      insertVariableAndOffsetPathToNode(target, modifiedAst, mNodeToEdit)
    }
    if (distance && 'variableName' in distance && distance.variableName) {
      insertVariableAndOffsetPathToNode(distance, modifiedAst, mNodeToEdit)
    }
  }
  if (!camera) return new Error('Could not determine the named view camera.')

  const call = createCallExpressionStdLibKw(
    namedCall.name,
    createLiteral(name, wasmInstance),
    [
      createLabeledArg('camera', camera),
      createLabeledArg('baseline', viewEnum('Visibility', baseline)),
      ...(exceptVars.exprs.length > 0
        ? [createLabeledArg('except', createArrayExpression(exceptVars.exprs))]
        : []),
    ],
    undefined,
    namedCall.path.map(createIdentifier)
  )

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    labeledSelectionArgNames: ['except'],
    // The unlabeled argument is a name, not a read-only selection.
    preserveUnlabeledArgument: false,
    variableIfNewDecl: 'view',
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return { modifiedAst, pathToNode }
}

// A captured camera has an explicit target and distance rather than fitting the model.
export type NamedViewCameraSnapshot = ArtifactCameraView & {
  look: Extract<ArtifactCameraView['look'], { type: 'directed' }>
  target: NonNullable<ArtifactCameraView['target']>
  distance: NonNullable<ArtifactCameraView['distance']>
}

export type NamedViewCameraMode = ArtifactCameraView['look']['type']
// Keep an existing camera expression until the user explicitly recaptures it.
export type NamedViewCameraInput = NamedViewCameraSnapshot | Expr

function point3d(
  value: ArtifactPoint3d,
  wasmInstance: ModuleType,
  suffix?: 'Mm'
) {
  return createArrayExpression(
    [value.x, value.y, value.z].map((value) =>
      createLiteral(
        roundOff(value, CAPTURED_CAMERA_DECIMALS),
        wasmInstance,
        suffix,
        CAPTURED_CAMERA_DECIMALS
      )
    )
  )
}

function createCapturedCamera(
  camera: NamedViewCameraSnapshot,
  wasmInstance: ModuleType
) {
  return createCallExpressionStdLibKw(
    'directed',
    point3d(camera.look.direction, wasmInstance),
    [
      createLabeledArg('up', point3d(camera.look.up, wasmInstance)),
      createLabeledArg('target', point3d(camera.target, wasmInstance, 'Mm')),
      createLabeledArg(
        'distance',
        createLiteral(
          roundOff(camera.distance, CAPTURED_CAMERA_DECIMALS),
          wasmInstance,
          'Mm',
          CAPTURED_CAMERA_DECIMALS
        )
      ),
      createLabeledArg(
        'projection',
        viewEnum('Projection', capitaliseFC(camera.projection))
      ),
    ],
    undefined,
    [createIdentifier('view')]
  )
}
