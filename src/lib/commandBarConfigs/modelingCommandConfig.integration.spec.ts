import { getNextAvailableDatumName } from '@src/lang/modifyAst/gdt'
import { type Artifact, assertParse } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import {
  extrudeSelectionRequiresBodyType,
  extrudeSelectionRequiresMethod,
  getDefaultGdtTolerance,
  type ModelingCommandSchema,
  modelingMachineCommandConfig,
  profileSelectionRequiresBodyType,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import {
  modelingCommandStdLibDriftConfig,
  modelingStdLibCommandArgs,
  modelingStdLibCommandStatus,
  modelingStdLibCommandUsesExperimentalFeatures,
  type StdLibCommandDriftConfig,
  stdLibCommandStatus,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import { STD_LIB_COMMANDS } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import type {
  CommandArgumentConfig,
  KclCommandValue,
} from '@src/lib/commandTypes'
import { isArray } from '@src/lib/utils'
import type {
  ModelingMachineContext,
  Selections,
} from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

function selectionsForArtifact(artifact?: Artifact): Selections {
  return {
    graphSelections: [
      {
        artifact,
        codeRef: { range: [0, 1, 0], pathToNode: [] },
      },
    ],
    otherSelections: [],
  }
}

function parsedLength(value = '5'): KclCommandValue {
  return {
    valueAst: {},
    valueText: value,
    valueCalculated: value,
  } as KclCommandValue
}

function bodyTypeRequiredForCommand(
  commandName: 'Extrude' | 'Sweep' | 'Loft' | 'Revolve',
  argumentsToSubmit: Record<string, unknown>
): boolean {
  const commandConfig = modelingMachineCommandConfig[commandName]
  if (!commandConfig || isArray(commandConfig)) {
    throw new Error(`${commandName} should have a single command config`)
  }

  const bodyTypeArg = commandConfig.args?.bodyType
  if (!bodyTypeArg) {
    throw new Error(`${commandName} should expose bodyType`)
  }

  return typeof bodyTypeArg.required === 'function'
    ? bodyTypeArg.required({ argumentsToSubmit })
    : bodyTypeArg.required
}

describe('GDT Datum Default Name', () => {
  it('should work with command bar when datum A already exists', async () => {
    // Test command bar integration with existing datum
    const codeWithDatum = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
gdt::datum(face = capEnd001, name = "A")`

    const { instance } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(codeWithDatum, instance)

    // Should return 'B' since 'A' is already used
    expect(getNextAvailableDatumName(ast)).toBe('B')
  })
})

describe('GDT tolerance defaults', () => {
  it('uses the current file unit for the tolerance input default', () => {
    const modelingContext = {
      kclManager: {
        fileSettings: {
          defaultLengthUnit: 'in',
        },
      },
    } as unknown as ModelingMachineContext

    expect(getDefaultGdtTolerance({}, modelingContext)).toBe('0.1in')
    expect(getDefaultGdtTolerance({})).toBe('0.1mm')
  })

  it('wires the unit-aware default into tolerance-bearing GD&T commands', () => {
    const commandNames = [
      'GDT Flatness',
      'GDT Position',
      'GDT Profile',
      'GDT Distance',
      'GDT Perpendicularity',
      'GDT Angularity',
      'GDT Concentricity',
      'GDT Symmetry',
      'GDT Runout',
      'GDT Parallelism',
    ] as const

    for (const commandName of commandNames) {
      const commandConfig = modelingMachineCommandConfig[commandName]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }

      expect(commandConfig.args?.tolerance).toMatchObject({
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
      })
      expect(
        commandConfig.args?.tolerance?.valueSummary?.({
          valueCalculated: '2.54mm',
          valueText: '0.1in',
        } as KclCommandValue)
      ).toBe('0.1in')
    }
  })

  it('requires datums for datum-axis GD&T commands', () => {
    for (const commandName of [
      'GDT Concentricity',
      'GDT Symmetry',
      'GDT Runout',
    ] as const) {
      const commandConfig = modelingMachineCommandConfig[commandName]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }

      expect(commandConfig.args?.datums).toMatchObject({
        inputType: 'kcl',
        required: true,
      })
    }
  })
})

describe('Extrude surface arguments', () => {
  function extrudeConfig() {
    const commandConfig = modelingMachineCommandConfig.Extrude
    if (!commandConfig || isArray(commandConfig)) {
      throw new Error('Extrude should have a single command config')
    }
    return commandConfig
  }

  function evaluateHidden(
    argName: keyof ModelingCommandSchema['Extrude'],
    argumentsToSubmit: Record<string, unknown>
  ) {
    const hidden = extrudeConfig().args?.[argName]?.hidden
    return typeof hidden === 'function'
      ? hidden({
          argumentsToSubmit,
          selectedCommand: { useModelingDialog: true },
        } as never)
      : Boolean(hidden)
  }

  function evaluateRequired(
    argName: keyof ModelingCommandSchema['Extrude'],
    argumentsToSubmit: Record<string, unknown>
  ) {
    const required = extrudeConfig().args?.[argName]?.required
    return typeof required === 'function'
      ? required({
          argumentsToSubmit,
          selectedCommand: { useModelingDialog: true },
        } as never)
      : Boolean(required)
  }

  it('allows extrude profiles to include body edge selections', () => {
    const commandConfig = extrudeConfig()

    expect(commandConfig.args?.sketches).toMatchObject({
      inputType: 'selection',
      selectionTypes: expect.arrayContaining([
        'segment',
        'sweepEdge',
        'primitiveEdge',
        'enginePrimitiveEdge',
      ]),
    })
  })

  it('shows only fields associated with the selected extent and direction', () => {
    const distance = {
      extentType: 'distance',
      directionMode: 'oneSide',
    }
    expect(evaluateHidden('length', distance)).toBe(false)
    expect(evaluateRequired('length', distance)).toBe(true)
    expect(evaluateHidden('to', distance)).toBe(true)
    expect(evaluateHidden('bidirectionalLength', distance)).toBe(true)

    const twoSides = { ...distance, directionMode: 'twoSides' }
    expect(evaluateHidden('bidirectionalLength', twoSides)).toBe(false)
    expect(evaluateRequired('bidirectionalLength', twoSides)).toBe(true)

    const toFace = { extentType: 'toFace', directionMode: 'twoSides' }
    expect(evaluateHidden('length', toFace)).toBe(true)
    expect(evaluateHidden('to', toFace)).toBe(false)
    expect(evaluateRequired('to', toFace)).toBe(true)
    expect(evaluateHidden('directionMode', toFace)).toBe(true)
  })

  it('hydrates dialog modes from an existing Extrude call', () => {
    const extentType = extrudeConfig().args?.extentType
    const directionMode = extrudeConfig().args?.directionMode
    if (
      extentType?.inputType !== 'options' ||
      typeof extentType.defaultValue !== 'function' ||
      directionMode?.inputType !== 'options' ||
      typeof directionMode.defaultValue !== 'function'
    ) {
      throw new Error('Extrude dialog modes should have derived defaults')
    }

    expect(
      extentType.defaultValue({
        argumentsToSubmit: { to: selectionsForArtifact() },
      } as never)
    ).toBe('toFace')
    expect(
      directionMode.defaultValue({
        argumentsToSubmit: { symmetric: true },
      } as never)
    ).toBe('symmetric')
    expect(
      directionMode.defaultValue({
        argumentsToSubmit: { bidirectionalLength: parsedLength() },
      } as never)
    ).toBe('twoSides')
  })

  it('keeps dependent twist controls hidden until twist is enabled', () => {
    const defaultArgs = { extentType: 'distance' }
    expect(evaluateHidden('twistAngleStep', defaultArgs)).toBe(true)
    expect(evaluateHidden('twistCenter', defaultArgs)).toBe(true)

    const twistedArgs = { ...defaultArgs, twistAngle: parsedLength('30deg') }
    expect(evaluateHidden('twistAngleStep', twistedArgs)).toBe(false)
    expect(evaluateHidden('twistCenter', twistedArgs)).toBe(false)
  })

  it('uses compact profile collection and puts operation in Result', () => {
    expect(extrudeConfig().args?.sketches.dialog).toMatchObject({
      group: 'selection',
      compactSelection: true,
    })
    expect(extrudeConfig().args?.method?.dialog).toMatchObject({
      group: 'result',
      controlStyle: 'segmented',
    })
    expect(extrudeConfig().dialogLayout).toMatchObject({
      showCommandDescription: false,
    })
  })

  it('requires bodyType when extruding sketch segments after length is confirmed', () => {
    expect(
      bodyTypeRequiredForCommand('Extrude', {
        sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
        length: parsedLength(),
      })
    ).toBe(true)
  })

  it('requires bodyType when extruding sweep edges after length is confirmed', () => {
    expect(
      bodyTypeRequiredForCommand('Extrude', {
        sketches: selectionsForArtifact({ type: 'sweepEdge' } as Artifact),
        length: parsedLength(),
      })
    ).toBe(true)
  })

  it('requires bodyType when extruding engine edge selections after length is confirmed', () => {
    expect(
      bodyTypeRequiredForCommand('Extrude', {
        sketches: {
          graphSelections: [],
          otherSelections: [
            {
              type: 'enginePrimitive',
              entityId: 'edge-entity',
              parentEntityId: 'body-entity',
              primitiveIndex: 0,
              primitiveType: 'edge',
            },
          ],
        },
        length: parsedLength(),
      })
    ).toBe(true)
  })

  it('requires method when extruding body edges after length is confirmed', () => {
    expect(
      extrudeSelectionRequiresMethod({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({ type: 'sweepEdge' } as Artifact),
          length: parsedLength(),
        },
      })
    ).toBe(true)

    expect(
      extrudeSelectionRequiresMethod({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({
            type: 'primitiveEdge',
          } as Artifact),
          length: parsedLength(),
        },
      })
    ).toBe(true)

    expect(
      extrudeSelectionRequiresMethod({
        argumentsToSubmit: {
          sketches: {
            graphSelections: [],
            otherSelections: [
              {
                type: 'enginePrimitive',
                entityId: 'edge-entity',
                parentEntityId: 'body-entity',
                primitiveIndex: 0,
                primitiveType: 'edge',
              },
            ],
          },
          length: parsedLength(),
        },
      })
    ).toBe(true)
  })

  it('keeps method optional for sketch segments and before length is confirmed', () => {
    expect(
      extrudeSelectionRequiresMethod({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
          length: parsedLength(),
        },
      })
    ).toBe(false)

    expect(
      extrudeSelectionRequiresMethod({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({ type: 'sweepEdge' } as Artifact),
          length: '5',
        },
      })
    ).toBe(false)
  })

  it('keeps bodyType optional for sketch segments before length is confirmed', () => {
    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
          length: '5',
        },
      })
    ).toBe(false)
  })

  it('keeps bodyType optional for closed extrude profiles and regions', () => {
    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({ type: 'solid2d' } as Artifact),
          length: parsedLength(),
        },
      })
    ).toBe(false)

    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: selectionsForArtifact({
            type: 'path',
            subType: 'region',
          } as Artifact),
          length: parsedLength(),
        },
      })
    ).toBe(false)
  })

  it('requires bodyType for valid segment selections before artifact data is available', () => {
    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: selectionsForArtifact(),
          length: parsedLength(),
        },
      })
    ).toBe(true)
  })
})

describe('Revolve dialog arguments', () => {
  function revolveConfig() {
    const commandConfig = modelingMachineCommandConfig.Revolve
    if (!commandConfig || isArray(commandConfig)) {
      throw new Error('Revolve should have a single command config')
    }
    return commandConfig
  }

  function evaluateHidden(
    argName: keyof ModelingCommandSchema['Revolve'],
    argumentsToSubmit: Record<string, unknown>,
    useModelingDialog = true
  ) {
    const hidden = revolveConfig().args?.[argName]?.hidden
    return typeof hidden === 'function'
      ? hidden({
          argumentsToSubmit,
          selectedCommand: { useModelingDialog },
        } as never)
      : Boolean(hidden)
  }

  function evaluateRequired(
    argName: keyof ModelingCommandSchema['Revolve'],
    argumentsToSubmit: Record<string, unknown>,
    useModelingDialog = true
  ) {
    const required = revolveConfig().args?.[argName]?.required
    return typeof required === 'function'
      ? required({
          argumentsToSubmit,
          selectedCommand: { useModelingDialog },
        } as never)
      : Boolean(required)
  }

  it('uses grouped, compact profile and axis controls', () => {
    expect(
      revolveConfig().dialogLayout?.groups.map((group) => group.id)
    ).toEqual(['selection', 'axis', 'extent', 'result', 'advanced'])
    expect(revolveConfig().dialogLayout).toMatchObject({
      showCommandDescription: false,
    })
    expect(revolveConfig().args?.sketches.dialog).toMatchObject({
      group: 'selection',
      compactSelection: true,
    })
    expect(revolveConfig().args?.axisOrEdge.dialog).toMatchObject({
      group: 'axis',
      controlStyle: 'segmented',
    })
  })

  it('shows only fields for the selected axis and extent modes', () => {
    const fullAxis = {
      axisOrEdge: 'Axis',
      extentType: 'full',
      directionMode: 'twoSides',
    }
    expect(evaluateHidden('axis', fullAxis)).toBe(false)
    expect(evaluateRequired('axis', fullAxis)).toBe(true)
    expect(evaluateHidden('edge', fullAxis)).toBe(true)
    expect(evaluateHidden('angle', fullAxis)).toBe(true)
    expect(evaluateRequired('angle', fullAxis)).toBe(false)
    expect(evaluateHidden('directionMode', fullAxis)).toBe(true)

    const angleEdge = {
      axisOrEdge: 'Edge',
      extentType: 'angle',
      directionMode: 'oneSide',
    }
    expect(evaluateHidden('axis', angleEdge)).toBe(true)
    expect(evaluateHidden('edge', angleEdge)).toBe(false)
    expect(evaluateRequired('edge', angleEdge)).toBe(true)
    expect(evaluateHidden('angle', angleEdge)).toBe(false)
    expect(evaluateRequired('angle', angleEdge)).toBe(true)
    expect(evaluateHidden('directionMode', angleEdge)).toBe(false)
    expect(evaluateHidden('bidirectionalAngle', angleEdge)).toBe(true)

    const twoSides = { ...angleEdge, directionMode: 'twoSides' }
    expect(evaluateHidden('bidirectionalAngle', twoSides)).toBe(false)
    expect(evaluateRequired('bidirectionalAngle', twoSides)).toBe(true)
  })

  it('hydrates UI modes from existing Revolve arguments', () => {
    const axisOrEdge = revolveConfig().args?.axisOrEdge
    const extentType = revolveConfig().args?.extentType
    const directionMode = revolveConfig().args?.directionMode
    if (
      axisOrEdge?.inputType !== 'options' ||
      typeof axisOrEdge.defaultValue !== 'function' ||
      extentType?.inputType !== 'options' ||
      typeof extentType.defaultValue !== 'function' ||
      directionMode?.inputType !== 'options' ||
      typeof directionMode.defaultValue !== 'function'
    ) {
      throw new Error('Revolve dialog modes should have derived defaults')
    }

    expect(
      axisOrEdge.defaultValue({
        argumentsToSubmit: { edge: selectionsForArtifact() },
      } as never)
    ).toBe('Edge')
    expect(extentType.defaultValue({ argumentsToSubmit: {} } as never)).toBe(
      'full'
    )
    expect(
      extentType.defaultValue({
        argumentsToSubmit: { angle: parsedLength('90deg') },
      } as never)
    ).toBe('angle')
    expect(
      directionMode.defaultValue({
        argumentsToSubmit: { symmetric: true },
      } as never)
    ).toBe('symmetric')
    expect(
      directionMode.defaultValue({
        argumentsToSubmit: { bidirectionalAngle: parsedLength('30deg') },
      } as never)
    ).toBe('twoSides')
  })

  it('keeps UI-only modes out of the legacy command bar', () => {
    expect(evaluateHidden('extentType', {}, false)).toBe(true)
    expect(evaluateHidden('directionMode', {}, false)).toBe(true)
    expect(evaluateRequired('angle', {}, false)).toBe(true)
  })
})

describe('Hole dialog arguments', () => {
  function holeConfig() {
    const commandConfig = modelingMachineCommandConfig.Hole
    if (!commandConfig || isArray(commandConfig)) {
      throw new Error('Hole should have a single command config')
    }
    return commandConfig
  }

  function evaluateHidden(
    argName: keyof ModelingCommandSchema['Hole'],
    argumentsToSubmit: Record<string, unknown>
  ) {
    const hidden = holeConfig().args?.[argName]?.hidden
    return typeof hidden === 'function'
      ? hidden({
          argumentsToSubmit,
          selectedCommand: { useModelingDialog: true },
        } as never)
      : Boolean(hidden)
  }

  function evaluateRequired(
    argName: keyof ModelingCommandSchema['Hole'],
    argumentsToSubmit: Record<string, unknown>
  ) {
    const required = holeConfig().args?.[argName]?.required
    return typeof required === 'function'
      ? required({
          argumentsToSubmit,
          selectedCommand: { useModelingDialog: true },
        } as never)
      : Boolean(required)
  }

  it('uses grouped placement, hole, bottom, and advanced sections', () => {
    expect(holeConfig().dialogLayout?.groups.map((group) => group.id)).toEqual([
      'placement',
      'hole',
      'bottom',
      'advanced',
    ])
    expect(holeConfig().dialogLayout).toMatchObject({
      showCommandDescription: false,
    })
    expect(holeConfig().args?.face.dialog).toMatchObject({
      group: 'placement',
      compactSelection: true,
    })
    expect(holeConfig().args?.holeType?.dialog).toMatchObject({
      group: 'hole',
      controlStyle: 'segmented',
    })
  })

  it('defaults hidden implementation choices to a simple flat blind hole', () => {
    expect(holeConfig().args?.holeBody).toMatchObject({
      required: true,
      defaultValue: 'blind',
    })
    expect(evaluateHidden('holeBody', {})).toBe(true)
    expect(holeConfig().args?.holeType).toMatchObject({
      required: true,
      defaultValue: 'simple',
    })
    expect(holeConfig().args?.holeBottom).toMatchObject({
      required: true,
      defaultValue: 'flat',
    })
  })

  it('shows only dimensions associated with the selected head type', () => {
    const simple = { holeType: 'simple', holeBottom: 'flat' }
    expect(evaluateHidden('counterboreDepth', simple)).toBe(true)
    expect(evaluateHidden('counterboreDiameter', simple)).toBe(true)
    expect(evaluateHidden('countersinkAngle', simple)).toBe(true)
    expect(evaluateHidden('countersinkDiameter', simple)).toBe(true)

    const counterbore = { ...simple, holeType: 'counterbore' }
    expect(evaluateHidden('counterboreDepth', counterbore)).toBe(false)
    expect(evaluateRequired('counterboreDepth', counterbore)).toBe(true)
    expect(evaluateHidden('counterboreDiameter', counterbore)).toBe(false)
    expect(evaluateRequired('counterboreDiameter', counterbore)).toBe(true)
    expect(evaluateHidden('countersinkAngle', counterbore)).toBe(true)

    const countersink = { ...simple, holeType: 'countersink' }
    expect(evaluateHidden('countersinkAngle', countersink)).toBe(false)
    expect(evaluateRequired('countersinkAngle', countersink)).toBe(true)
    expect(evaluateHidden('countersinkDiameter', countersink)).toBe(false)
    expect(evaluateRequired('countersinkDiameter', countersink)).toBe(true)
    expect(evaluateHidden('countersinkHeadClearance', countersink)).toBe(false)
    expect(evaluateHidden('counterboreDepth', countersink)).toBe(true)
  })

  it('shows point angle only for a drill-point bottom', () => {
    expect(evaluateHidden('drillPointAngle', { holeBottom: 'flat' })).toBe(true)
    expect(evaluateHidden('drillPointAngle', { holeBottom: 'drill' })).toBe(
      false
    )
    expect(evaluateRequired('drillPointAngle', { holeBottom: 'drill' })).toBe(
      true
    )
  })
})

describe('Sweep-like bodyType argument', () => {
  it('allows sweep profiles to be selected from sketches, segments, regions, and faces', () => {
    const commandConfig = modelingMachineCommandConfig.Sweep
    if (!commandConfig || isArray(commandConfig)) {
      throw new Error('Sweep should have a single command config')
    }

    expect(commandConfig.args?.sketches).toMatchObject({
      inputType: 'selection',
      selectionTypes: [
        'solid2d',
        'segment',
        'cap',
        'wall',
        'pathRegion',
        'engineRegion',
      ],
    })
  })

  it('marks the legacy relativeTo argument as deprecated', () => {
    const commandConfig = modelingMachineCommandConfig.Sweep
    if (!commandConfig || isArray(commandConfig)) {
      throw new Error('Sweep should have a single command config')
    }

    expect(commandConfig.args?.relativeTo).toMatchObject({
      inputType: 'options',
      status: 'deprecated',
      statusMessage:
        "Deprecated. Use 'translateProfileToPath' and 'orientProfilePerpendicular' instead. What is the sweep relative to? Can be either 'sketchPlane' or 'trajectoryCurve'.",
    })
  })

  it('requires bodyType for sweep segment profiles after the path is selected', () => {
    expect(
      bodyTypeRequiredForCommand('Sweep', {
        sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
        path: selectionsForArtifact({ type: 'path' } as Artifact),
      })
    ).toBe(true)
  })

  it('checks sweep profiles without treating the path segment as a surface profile', () => {
    expect(
      bodyTypeRequiredForCommand('Sweep', {
        sketches: selectionsForArtifact({ type: 'solid2d' } as Artifact),
        path: selectionsForArtifact({ type: 'segment' } as Artifact),
      })
    ).toBe(false)
  })

  it('requires bodyType for loft and revolve segment profiles', () => {
    for (const commandName of ['Loft', 'Revolve'] as const) {
      expect(
        bodyTypeRequiredForCommand(commandName, {
          sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
        })
      ).toBe(true)
    }
  })

  it('keeps bodyType optional for closed profiles and regions', () => {
    for (const artifact of [
      { type: 'solid2d' },
      { type: 'path', subType: 'region' },
    ] as Artifact[]) {
      expect(
        profileSelectionRequiresBodyType({
          argumentsToSubmit: {
            sketches: selectionsForArtifact(artifact),
          },
        })
      ).toBe(false)
    }
  })
})

describe('Transform arguments', () => {
  it('accepts helices only for supported transforms', () => {
    for (const commandName of [
      'Translate',
      'Rotate',
      'Scale',
      'Clone',
    ] as const) {
      const commandConfig = modelingMachineCommandConfig[commandName]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }

      const objectsArg = commandConfig.args?.objects
      if (!objectsArg || !('selectionTypes' in objectsArg)) {
        throw new Error(`${commandName}.objects should be a selection argument`)
      }
      const selectionTypes = objectsArg.selectionTypes
      if (commandName === 'Translate' || commandName === 'Scale') {
        expect(selectionTypes).toContain('helix')
      } else {
        expect(selectionTypes).not.toContain('helix')
      }
    }
  })
})

const uniqueSorted = (values: string[]) => [...new Set(values)].sort()

describe('stdlib command arg derivation', () => {
  it('derives base command-bar arg config from KCL stdlib metadata', () => {
    const args = modelingStdLibCommandArgs<ModelingCommandSchema['Extrude']>(
      'Extrude',
      {
        overrides: {
          sketches: {
            inputType: 'selection',
            selectionTypes: [],
            multiple: true,
          },
        },
      }
    )

    expect(args.sketches).toMatchObject({
      inputType: 'selection',
      required: true,
    })
    expect(args.length).toMatchObject({ inputType: 'kcl', required: false })
    expect(args.symmetric).toMatchObject({
      inputType: 'boolean',
      required: false,
    })
    expect(args.tagStart).toMatchObject({
      inputType: 'tagDeclarator',
      required: false,
    })
    expect(args.draftAngle).toMatchObject({
      inputType: 'kcl',
      required: false,
      status: 'experimental',
    })
    expect(args.twistCenter).toMatchObject({
      inputType: 'vector2d',
      required: false,
    })
    expect(args.direction).toMatchObject({
      required: false,
    })
    expect(args.direction.status).toBeUndefined()
  })

  it('derives command status from KCL stdlib metadata', () => {
    expect(modelingStdLibCommandStatus('Helical Gear')).toBe('experimental')
    expect(modelingStdLibCommandStatus('Extrude')).toBeUndefined()
    expect(stdLibCommandStatus('startSketchOn')).toBe('deprecated')
  })

  it('derives experimental settings from KCL stdlib metadata', () => {
    const cases: [
      Parameters<typeof modelingStdLibCommandUsesExperimentalFeatures>[0],
      Record<string, unknown>,
      boolean,
    ][] = [
      ['Extrude', {}, false],
      ['Extrude', { draftAngle: parsedLength('45deg') }, true],
      ['Extrude', { direction: selectionsForArtifact() }, false],
      ['Fillet', { edges: selectionsForArtifact() }, false],
      ['Fillet', { version: parsedLength('2') }, true],
      ['Helical Gear', {}, true],
    ]

    for (const [commandName, args, usesExperimentalFeatures] of cases) {
      expect(
        modelingStdLibCommandUsesExperimentalFeatures(commandName, args),
        commandName
      ).toBe(usesExperimentalFeatures)
    }
  })

  it('keeps non-experimental stdlib args non-experimental in the command bar', () => {
    const sweepCommand = modelingMachineCommandConfig.Sweep
    if (!sweepCommand || isArray(sweepCommand)) {
      throw new Error('Sweep should have a single command config')
    }

    expect(sweepCommand.args?.version?.status).toBeUndefined()
    expect(
      modelingStdLibCommandUsesExperimentalFeatures('Sweep', {
        version: parsedLength('2'),
      })
    ).toBe(false)
  })
})

describe('modeling command stdlib drift', () => {
  it('covers every shared modeling codemod', () => {
    expect(Object.keys(modelingCommandStdLibDriftConfig).sort()).toEqual(
      Object.keys(modelingCommandCodemods).sort()
    )
  })

  it('keeps command-bar args aligned with KCL stdlib signatures', () => {
    for (const [commandName, driftConfig] of Object.entries(
      modelingCommandStdLibDriftConfig
    ) as [string, StdLibCommandDriftConfig][]) {
      const commandConfig =
        modelingMachineCommandConfig[
          commandName as keyof typeof modelingMachineCommandConfig
        ]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }

      const stdLibCommand = STD_LIB_COMMANDS[driftConfig.stdLibName]
      expect(
        stdLibCommand,
        `${commandName} references missing stdlib function ${driftConfig.stdLibName}`
      ).toBeDefined()

      const omittedStdLibArgs = new Set(driftConfig.omittedStdLibArgs ?? [])
      const deprecatedStdLibArgs = new Set(
        driftConfig.deprecatedStdLibArgs ?? []
      )
      const editFlowArgs = driftConfig.editFlow ? ['nodeToEdit'] : []
      const expectedStdLibArgOrder = stdLibCommand.args
        .filter(
          (arg) =>
            (!arg.deprecated && arg.deprecatedSince === null) ||
            deprecatedStdLibArgs.has(arg.name)
        )
        .filter((arg) => !omittedStdLibArgs.has(arg.name))
        .map((arg) => driftConfig.argAliases?.[arg.name] ?? arg.name)
      const expectedArgs = uniqueSorted([
        ...expectedStdLibArgOrder,
        ...(driftConfig.uiOnlyArgs ?? []),
        ...editFlowArgs,
      ])
      const actualArgOrder = Object.keys(commandConfig.args ?? {})
      const actualArgs = uniqueSorted(actualArgOrder)

      expect(
        actualArgs,
        `${commandName} command args drifted from ${driftConfig.stdLibName}. Add a command arg, or document the intentional difference in modelingCommandStdLibDriftConfig.`
      ).toEqual(expectedArgs)

      if (driftConfig.flowArgOrder) {
        const actualFlowArgOrder = Object.entries(commandConfig.args ?? {})
          .filter(([, arg]) => {
            const { prepopulate, required, skip } = arg as {
              prepopulate?: unknown
              required?: unknown
              skip?: unknown
            }
            return (
              required === true ||
              typeof required === 'function' ||
              prepopulate === true ||
              skip === false
            )
          })
          .map(([argName]) => argName)

        expect(
          actualFlowArgOrder,
          `${commandName} command-bar flow arg order drifted from the legacy command-bar order.`
        ).toEqual(driftConfig.flowArgOrder)
      }
    }
  })

  it('only shows deprecated args when editing a command that already has them', () => {
    for (const commandName of Object.keys(modelingCommandStdLibDriftConfig)) {
      const commandConfig =
        modelingMachineCommandConfig[
          commandName as keyof typeof modelingMachineCommandConfig
        ]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }

      const commandArgs = (commandConfig.args ?? {}) as Record<
        string,
        CommandArgumentConfig<unknown, ModelingMachineContext>
      >

      for (const [argName, arg] of Object.entries(commandArgs)) {
        if (arg.status !== 'deprecated') {
          continue
        }

        const hidden = arg.hidden
        expect(
          typeof hidden,
          `${commandName}.${argName} should have a hidden predicate`
        ).toBe('function')
        if (typeof hidden !== 'function') {
          continue
        }

        expect(hidden({ argumentsToSubmit: {} })).toBe(true)
        expect(
          hidden({
            argumentsToSubmit: { nodeToEdit: [] },
          })
        ).toBe(true)
        expect(
          hidden({
            argumentsToSubmit: {
              nodeToEdit: [],
              [argName]: 'existing',
            },
          })
        ).toBe(false)
      }
    }
  })
})
