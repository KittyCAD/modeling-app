import type { StdLibCommandName } from '@rust/kcl-lib/bindings/StdLibCommands'

import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'

type ModelingCommandName = Extract<keyof ModelingCommandSchema, string>

export type StdLibCommandDriftConfig = {
  stdLibName: StdLibCommandName
  /**
   * Command-bar arguments that are not KCL stdlib arguments. These usually
   * control editing flows or split one KCL value into easier UI inputs.
   */
  uiOnlyArgs?: readonly string[]
  /**
   * KCL stdlib arguments intentionally not exposed by the command bar.
   */
  omittedStdLibArgs?: readonly string[]
  /**
   * KCL stdlib argument names that are exposed under a different command-bar
   * argument name.
   */
  argAliases?: Readonly<Record<string, string>>
}

const editFlowArgs = ['nodeToEdit'] as const

export const modelingCommandStdLibDriftConfig = {
  Extrude: {
    stdLibName: 'extrude',
    uiOnlyArgs: editFlowArgs,
  },
  Sweep: {
    stdLibName: 'sweep',
    uiOnlyArgs: editFlowArgs,
    omittedStdLibArgs: ['tolerance', 'version'],
  },
  Loft: {
    stdLibName: 'loft',
    uiOnlyArgs: editFlowArgs,
    omittedStdLibArgs: ['tolerance'],
  },
  Revolve: {
    stdLibName: 'revolve',
    uiOnlyArgs: [...editFlowArgs, 'axisOrEdge', 'edge'],
    omittedStdLibArgs: ['tolerance'],
  },
  Shell: {
    stdLibName: 'shell',
    uiOnlyArgs: editFlowArgs,
    omittedStdLibArgs: ['solids'],
  },
  Hole: {
    stdLibName: 'hole::hole',
    uiOnlyArgs: [
      ...editFlowArgs,
      'blindDepth',
      'blindDiameter',
      'counterboreDepth',
      'counterboreDiameter',
      'countersinkAngle',
      'countersinkDiameter',
      'countersinkHeadClearance',
      'drillPointAngle',
    ],
    omittedStdLibArgs: ['solid'],
  },
  Fillet: {
    stdLibName: 'fillet',
    uiOnlyArgs: editFlowArgs,
    omittedStdLibArgs: ['solid', 'tolerance'],
    argAliases: {
      tags: 'selection',
    },
  },
  Chamfer: {
    stdLibName: 'chamfer',
    uiOnlyArgs: editFlowArgs,
    omittedStdLibArgs: ['solid'],
    argAliases: {
      tags: 'selection',
    },
  },
  'Offset plane': {
    stdLibName: 'offsetPlane',
    uiOnlyArgs: editFlowArgs,
  },
  Helix: {
    stdLibName: 'helix',
    uiOnlyArgs: [...editFlowArgs, 'mode', 'edge'],
  },
  'Helical Gear': {
    stdLibName: 'gear::helical',
    uiOnlyArgs: editFlowArgs,
  },
  'Herringbone Gear': {
    stdLibName: 'gear::herringbone',
    uiOnlyArgs: editFlowArgs,
  },
  'Spur Gear': {
    stdLibName: 'gear::spur',
    uiOnlyArgs: editFlowArgs,
  },
  'Ring Gear': {
    stdLibName: 'gear::ring',
    uiOnlyArgs: editFlowArgs,
  },
  Appearance: {
    stdLibName: 'appearance',
    uiOnlyArgs: editFlowArgs,
    argAliases: {
      solids: 'objects',
    },
  },
  Translate: {
    stdLibName: 'translate',
    uiOnlyArgs: editFlowArgs,
    omittedStdLibArgs: ['xyz'],
  },
  Rotate: {
    stdLibName: 'rotate',
    uiOnlyArgs: editFlowArgs,
    omittedStdLibArgs: ['axis', 'angle'],
  },
  Scale: {
    stdLibName: 'scale',
    uiOnlyArgs: editFlowArgs,
  },
  Clone: {
    stdLibName: 'clone',
    uiOnlyArgs: [...editFlowArgs, 'variableName'],
    argAliases: {
      geometries: 'objects',
    },
  },
  'Mirror 3D': {
    stdLibName: 'mirror3d',
  },
  'Pattern Circular 3D': {
    stdLibName: 'patternCircular3d',
    uiOnlyArgs: editFlowArgs,
  },
  'Pattern Linear 3D': {
    stdLibName: 'patternLinear3d',
    uiOnlyArgs: editFlowArgs,
  },
  'GDT Flatness': {
    stdLibName: 'gdt::flatness',
    uiOnlyArgs: editFlowArgs,
  },
  'GDT Straightness': {
    stdLibName: 'gdt::straightness',
    uiOnlyArgs: editFlowArgs,
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Datum': {
    stdLibName: 'gdt::datum',
    uiOnlyArgs: editFlowArgs,
    argAliases: {
      face: 'faces',
    },
  },
  'GDT Position': {
    stdLibName: 'gdt::position',
    uiOnlyArgs: editFlowArgs,
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Profile': {
    stdLibName: 'gdt::profile',
    uiOnlyArgs: editFlowArgs,
  },
  'GDT Distance': {
    stdLibName: 'gdt::distance',
    uiOnlyArgs: editFlowArgs,
    argAliases: {
      from: 'objects',
      to: 'objects',
      edges: 'objects',
    },
  },
  'GDT Perpendicularity': {
    stdLibName: 'gdt::perpendicularity',
    uiOnlyArgs: editFlowArgs,
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Parallelism': {
    stdLibName: 'gdt::parallelism',
    uiOnlyArgs: editFlowArgs,
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Annotation': {
    stdLibName: 'gdt::annotation',
    uiOnlyArgs: editFlowArgs,
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'Boolean Subtract': {
    stdLibName: 'subtract',
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Union': {
    stdLibName: 'union',
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Intersect': {
    stdLibName: 'intersect',
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Split': {
    stdLibName: 'split',
    uiOnlyArgs: editFlowArgs,
  },
  'Flip Surface': {
    stdLibName: 'flipSurface',
  },
  'Delete Face': {
    stdLibName: 'deleteFace',
    omittedStdLibArgs: ['body', 'faceIndices'],
  },
  Blend: {
    stdLibName: 'blend',
  },
  'Join Surfaces': {
    stdLibName: 'joinSurfaces',
    omittedStdLibArgs: ['tolerance'],
  },
} as const satisfies Partial<
  Record<ModelingCommandName, StdLibCommandDriftConfig>
>
