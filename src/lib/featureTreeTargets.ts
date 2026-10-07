import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { stdLibMap } from '@src/lib/operations'

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

/** Keep ownership separate from nesting when enabling feature-tree actions. */
export function getFeatureTreeCapabilities(
  operation: Operation,
  editableModuleId: number
): FeatureTreeCapabilities {
  const sourceNavigation = getSourceNavigation(operation)
  if (
    operation.type === 'ModuleInstance' ||
    operation.type === 'GroupEnd' ||
    operation.sourceRange[2] !== editableModuleId
  ) {
    return {
      canSelect: false,
      sourceNavigation,
      ...HIDDEN_ACTIONS,
    }
  }

  if (operation.type === 'ImportedGeometry') {
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
  operation: Operation
): FeatureTreeCapabilities['sourceNavigation'] {
  if (operation.type === 'ModuleInstance') {
    return { kind: 'module', moduleId: operation.moduleId }
  }
  if (operation.type === 'GroupEnd') {
    return null
  }
  return { kind: 'source', moduleId: operation.sourceRange[2] }
}
