import type { StdLibCommandName } from '@rust/kcl-lib/bindings/StdLibCommands'

import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'

type ModelingCommandName = Extract<keyof ModelingCommandSchema, string>

export type StdLibCommandDriftConfig = {
  stdLibName: StdLibCommandName
  /**
   * Additional command-bar arguments that are not KCL stdlib arguments. These
   * usually split one KCL value into easier UI inputs.
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

export const modelingCommandStdLibDriftConfig = {
  Extrude: {
    stdLibName: 'extrude',
    omittedStdLibArgs: ['direction'],
  },
  Sweep: {
    stdLibName: 'sweep',
    omittedStdLibArgs: ['tolerance', 'version'],
  },
  Loft: {
    stdLibName: 'loft',
    omittedStdLibArgs: ['tolerance'],
  },
  Revolve: {
    stdLibName: 'revolve',
    uiOnlyArgs: ['axisOrEdge', 'edge'],
    omittedStdLibArgs: ['tolerance'],
  },
  Shell: {
    stdLibName: 'shell',
    omittedStdLibArgs: ['solids'],
  },
  Hole: {
    stdLibName: 'hole::hole',
    uiOnlyArgs: [
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
    omittedStdLibArgs: ['solid', 'tolerance'],
    argAliases: {
      tags: 'selection',
    },
  },
  Chamfer: {
    stdLibName: 'chamfer',
    omittedStdLibArgs: ['solid'],
    argAliases: {
      tags: 'selection',
    },
  },
  'Offset plane': {
    stdLibName: 'offsetPlane',
  },
  Helix: {
    stdLibName: 'helix',
    uiOnlyArgs: ['mode', 'edge'],
  },
  'Helical Gear': {
    stdLibName: 'gear::helical',
  },
  'Herringbone Gear': {
    stdLibName: 'gear::herringbone',
  },
  'Spur Gear': {
    stdLibName: 'gear::spur',
  },
  'Ring Gear': {
    stdLibName: 'gear::ring',
  },
  Appearance: {
    stdLibName: 'appearance',
    argAliases: {
      solids: 'objects',
    },
  },
  Translate: {
    stdLibName: 'translate',
    omittedStdLibArgs: ['xyz'],
  },
  Rotate: {
    stdLibName: 'rotate',
    omittedStdLibArgs: ['axis', 'angle'],
  },
  Scale: {
    stdLibName: 'scale',
  },
  Clone: {
    stdLibName: 'clone',
    uiOnlyArgs: ['variableName'],
    argAliases: {
      geometries: 'objects',
    },
  },
  'Mirror 3D': {
    stdLibName: 'mirror3d',
  },
  'Pattern Circular 3D': {
    stdLibName: 'patternCircular3d',
  },
  'Pattern Linear 3D': {
    stdLibName: 'patternLinear3d',
  },
  'GDT Flatness': {
    stdLibName: 'gdt::flatness',
  },
  'GDT Straightness': {
    stdLibName: 'gdt::straightness',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Circularity': {
    stdLibName: 'gdt::circularity',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Cylindricity': {
    stdLibName: 'gdt::cylindricity',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Datum': {
    stdLibName: 'gdt::datum',
    argAliases: {
      face: 'faces',
    },
  },
  'GDT Position': {
    stdLibName: 'gdt::position',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Profile': {
    stdLibName: 'gdt::profile',
  },
  'GDT Distance': {
    stdLibName: 'gdt::distance',
    argAliases: {
      from: 'objects',
      to: 'objects',
      edges: 'objects',
    },
  },
  'GDT Perpendicularity': {
    stdLibName: 'gdt::perpendicularity',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Parallelism': {
    stdLibName: 'gdt::parallelism',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Annotation': {
    stdLibName: 'gdt::annotation',
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
