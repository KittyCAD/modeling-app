import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { getArtifactFromRange } from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import { stdLibMap } from '@src/lib/operations'

type ModuleInstanceOperation = Extract<Operation, { type: 'ModuleInstance' }>
type ImportedGeometryOperation = Extract<
  Operation,
  { type: 'ImportedGeometry' }
>

export type FeatureTreeTarget =
  | {
      kind: 'kclModule'
      operation: ModuleInstanceOperation
      ownerModuleId: number
      artifact?: undefined
    }
  | {
      kind: 'geometry'
      geometryType: 'importedGeometry'
      operation: ImportedGeometryOperation
      ownerModuleId: number
      artifact?: Extract<Artifact, { type: 'importedGeometry' }>
    }
  | {
      kind: 'operation'
      operation: Exclude<
        Operation,
        ModuleInstanceOperation | ImportedGeometryOperation
      >
      ownerModuleId: number | null
      artifact?: undefined
    }

export type FeatureTreeActionAvailability = 'hidden' | 'disabled' | 'enabled'

export interface FeatureTreeCapabilities {
  canSelect: boolean
  sourceNavigation:
    | { kind: 'module'; moduleId: number }
    | { kind: 'source'; moduleId: number }
    | null
  edit: FeatureTreeActionAvailability
  appearance: FeatureTreeActionAvailability
  translate: FeatureTreeActionAvailability
  rotate: FeatureTreeActionAvailability
  scale: FeatureTreeActionAvailability
  clone: FeatureTreeActionAvailability
  remove: FeatureTreeActionAvailability
}

const HIDDEN_ACTIONS = {
  edit: 'hidden',
  appearance: 'hidden',
  translate: 'hidden',
  rotate: 'hidden',
  scale: 'hidden',
  clone: 'hidden',
  remove: 'hidden',
} as const

export function resolveFeatureTreeTarget(
  operation: Operation,
  artifactGraph: ArtifactGraph
): FeatureTreeTarget {
  if (operation.type === 'ModuleInstance') {
    return {
      kind: 'kclModule',
      operation,
      ownerModuleId: operation.sourceRange[2],
    }
  }

  if (operation.type === 'ImportedGeometry') {
    const artifact = getArtifactFromRange(operation.sourceRange, artifactGraph)
    return {
      kind: 'geometry',
      geometryType: 'importedGeometry',
      operation,
      ownerModuleId: operation.sourceRange[2],
      artifact: artifact?.type === 'importedGeometry' ? artifact : undefined,
    }
  }

  return {
    kind: 'operation',
    operation,
    ownerModuleId:
      operation.type === 'GroupEnd' ? null : operation.sourceRange[2],
  }
}

/**
 * Resolve every feature-tree interaction from the semantic target and the
 * module currently being edited. This keeps nesting/ownership separate from
 * operation type: adding a new target kind requires one resolver update rather
 * than conditionals throughout the tree UI.
 */
export function getFeatureTreeCapabilities(
  target: FeatureTreeTarget,
  editableModuleId: number
): FeatureTreeCapabilities {
  const sourceNavigation = getSourceNavigation(target)
  const isEditable =
    target.kind !== 'kclModule' && target.ownerModuleId === editableModuleId

  if (!isEditable) {
    return {
      canSelect: false,
      sourceNavigation,
      ...HIDDEN_ACTIONS,
    }
  }

  if (target.kind === 'geometry') {
    return {
      canSelect: true,
      sourceNavigation,
      edit: 'hidden',
      appearance: 'enabled',
      translate: 'enabled',
      rotate: 'enabled',
      scale: 'enabled',
      clone: 'enabled',
      remove: 'enabled',
    }
  }

  const operation = target.operation
  if (operation.type === 'GroupEnd') {
    return {
      canSelect: false,
      sourceNavigation,
      ...HIDDEN_ACTIONS,
    }
  }

  if (operation.type === 'VariableDeclaration') {
    return {
      canSelect: true,
      sourceNavigation,
      ...HIDDEN_ACTIONS,
      edit: 'enabled',
      remove: 'enabled',
    }
  }

  if (operation.type === 'GroupBegin') {
    const isFunctionCall = operation.group.type === 'FunctionCall'
    return {
      canSelect: true,
      sourceNavigation,
      edit: operation.group.type === 'SketchBlock' ? 'enabled' : 'hidden',
      appearance: isFunctionCall ? 'enabled' : 'hidden',
      translate: 'enabled',
      rotate: 'enabled',
      scale: 'enabled',
      clone: 'enabled',
      remove: 'enabled',
    }
  }

  const stdLibInfo = stdLibMap[operation.name]
  return {
    canSelect: true,
    sourceNavigation,
    edit: stdLibInfo?.prepareToEdit ? 'enabled' : 'disabled',
    appearance: stdLibInfo?.supportsAppearance ? 'enabled' : 'disabled',
    translate:
      stdLibInfo?.supportsTransform || stdLibInfo?.supportsTranslate
        ? 'enabled'
        : 'disabled',
    rotate:
      stdLibInfo?.supportsTransform || stdLibInfo?.supportsRotate
        ? 'enabled'
        : 'disabled',
    scale:
      stdLibInfo?.supportsTransform || stdLibInfo?.supportsScale
        ? 'enabled'
        : 'disabled',
    clone: stdLibInfo?.supportsTransform ? 'enabled' : 'disabled',
    remove: 'enabled',
  }
}

function getSourceNavigation(
  target: FeatureTreeTarget
): FeatureTreeCapabilities['sourceNavigation'] {
  if (target.kind === 'kclModule') {
    return { kind: 'module', moduleId: target.operation.moduleId }
  }
  if (target.ownerModuleId === null) {
    return null
  }
  return { kind: 'source', moduleId: target.ownerModuleId }
}
