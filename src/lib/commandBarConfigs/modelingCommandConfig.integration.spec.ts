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
  stdLibCommandArgDefaultSource,
  stdLibCommandSummary,
  stdLibCommandStatus,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import { STD_LIB_COMMANDS } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import type {
  CommandArgumentConfig,
  KclCommandValue,
} from '@src/lib/commandTypes'
import {
  KCL_AXIS_Z,
  KCL_DEFAULT_ROTATE_ANGLE,
  KCL_DEFAULT_SCALE_FACTOR,
  KCL_DEFAULT_TRANSLATE_X,
} from '@src/lib/constants'
import {
  canSubmitSelectionArg,
  type ResolvedSelectionType,
} from '@src/lib/selections'
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

function singleCommandConfig<Config>(
  config: Config | Config[] | undefined
): Config {
  if (!config || isArray(config)) {
    throw new Error('Expected a single command config')
  }
  return config
}

function argumentConditions<ArgName extends string>(
  args?: Partial<
    Record<
      ArgName,
      Pick<
        CommandArgumentConfig<unknown, ModelingMachineContext>,
        'hidden' | 'required'
      >
    >
  >
) {
  function evaluate(
    argName: ArgName,
    property: 'hidden' | 'required',
    argumentsToSubmit: Record<string, unknown>,
    useModelingDialog = true
  ) {
    const arg = args?.[argName]
    if (!arg) throw new Error(`Missing argument ${argName}`)
    const condition = arg[property]
    const context = {
      argumentsToSubmit,
      selectedCommand: { useModelingDialog },
    }
    return typeof condition === 'function'
      ? condition(context)
      : Boolean(condition)
  }

  return {
    evaluateHidden: (
      name: ArgName,
      values: Record<string, unknown>,
      dialog = true
    ) => evaluate(name, 'hidden', values, dialog),
    evaluateRequired: (
      name: ArgName,
      values: Record<string, unknown>,
      dialog = true
    ) => evaluate(name, 'required', values, dialog),
  }
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
  const config = singleCommandConfig(modelingMachineCommandConfig.Extrude)
  const { evaluateHidden, evaluateRequired } = argumentConditions(config.args)

  it('preserves the legacy Extrude operation default when dialogs are off', () => {
    const method = config.args?.method
    if (
      method?.inputType !== 'options' ||
      typeof method.options !== 'function'
    ) {
      throw new Error(
        'Extrude operation options should depend on the UI surface'
      )
    }

    const legacyOptions = method.options({
      argumentsToSubmit: {},
      selectedCommand: { useModelingDialog: false },
    } as never)
    const dialogOptions = method.options({
      argumentsToSubmit: {},
      selectedCommand: { useModelingDialog: true },
    } as never)

    expect(legacyOptions[0]).toMatchObject({ name: 'New', value: 'NEW' })
    expect(dialogOptions[0]).toMatchObject({ name: 'Merge', value: 'MERGE' })
  })

  it('allows extrude profiles to include body edge selections', () => {
    expect(config.args?.sketches).toMatchObject({
      inputType: 'selection',
      selectionTypes: expect.arrayContaining([
        'segment',
        'sweepEdge',
        'primitiveEdge',
        'enginePrimitiveEdge',
      ]),
    })
  })

  it('requires a distance only when no terminating face is selected', () => {
    expect(evaluateRequired('length', {})).toBe(true)
    expect(evaluateRequired('length', { to: selectionsForArtifact() })).toBe(
      false
    )
    for (const argName of ['to', 'symmetric', 'bidirectionalLength'] as const) {
      expect(evaluateHidden(argName, {})).toBe(false)
      expect(evaluateRequired(argName, {})).toBe(false)
    }
  })

  it('keeps surface output available for open profiles without a distance value', () => {
    for (const to of [undefined, selectionsForArtifact()]) {
      const argumentsToSubmit = {
        to,
        sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
      }
      expect(evaluateHidden('bodyType', argumentsToSubmit)).toBe(false)
      expect(evaluateRequired('bodyType', argumentsToSubmit)).toBe(true)
    }
  })

  it('shows body-edge operation before a distance value is parsed', () => {
    const argumentsToSubmit = {
      sketches: selectionsForArtifact({ type: 'sweepEdge' } as Artifact),
      length: '5',
    }
    expect(evaluateHidden('method', argumentsToSubmit)).toBe(false)
    expect(evaluateRequired('method', argumentsToSubmit)).toBe(true)
  })

  it('keeps native twist controls accessible as optional arguments', () => {
    for (const argName of [
      'twistAngle',
      'twistAngleStep',
      'twistCenter',
    ] as const) {
      expect(evaluateHidden(argName, {})).toBe(false)
      expect(evaluateRequired(argName, {})).toBe(false)
    }
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
            graphSelections: [
              {
                entityRef: {
                  type: 'edge',
                  side_faces: ['face-1', 'face-2'],
                },
                codeRef: { range: [0, 1, 0], pathToNode: [] },
              },
            ],
            otherSelections: [],
          },
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

  it('keeps bodyType optional for a Face API region without a legacy artifact', () => {
    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: {
            graphSelections: [
              {
                entityRef: { type: 'solid2d', solid2d_id: 'region-entity' },
                codeRef: { range: [0, 1, 0], pathToNode: [] },
              },
            ],
            otherSelections: [],
          },
          length: parsedLength(),
        },
      })
    ).toBe(false)
  })

  it('requires bodyType for a Face API edge without a legacy artifact', () => {
    expect(
      extrudeSelectionRequiresBodyType({
        argumentsToSubmit: {
          sketches: {
            graphSelections: [
              {
                entityRef: {
                  type: 'edge',
                  side_faces: ['face-1', 'face-2'],
                },
                codeRef: { range: [0, 1, 0], pathToNode: [] },
              },
            ],
            otherSelections: [],
          },
          length: parsedLength(),
        },
      })
    ).toBe(true)
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
  const config = singleCommandConfig(modelingMachineCommandConfig.Revolve)
  const { evaluateHidden, evaluateRequired } = argumentConditions(config.args)

  it('keeps the existing axis selector and exposes native angle controls', () => {
    expect(evaluateHidden('axis', { axisOrEdge: 'Axis' })).toBe(false)
    expect(evaluateRequired('axis', { axisOrEdge: 'Axis' })).toBe(true)
    expect(evaluateHidden('edge', { axisOrEdge: 'Axis' })).toBe(true)
    expect(evaluateHidden('axis', { axisOrEdge: 'Edge' })).toBe(true)
    expect(evaluateHidden('edge', { axisOrEdge: 'Edge' })).toBe(false)
    expect(evaluateRequired('edge', { axisOrEdge: 'Edge' })).toBe(true)

    for (const argName of [
      'angle',
      'symmetric',
      'bidirectionalAngle',
    ] as const) {
      expect(evaluateHidden(argName, {})).toBe(false)
      expect(evaluateRequired(argName, {})).toBe(false)
    }
    expect(evaluateRequired('angle', {}, false)).toBe(true)
  })

  it('waits for the legacy reference step before requiring an axis or edge', () => {
    for (const argumentsToSubmit of [
      {},
      { axis: 'X' },
      { edge: selectionsForArtifact() },
    ]) {
      expect(evaluateRequired('axis', argumentsToSubmit, false)).toBe(false)
      expect(evaluateRequired('edge', argumentsToSubmit, false)).toBe(false)
      expect(evaluateHidden('edge', argumentsToSubmit, false)).toBe(true)
    }

    expect(evaluateRequired('axis', { axisOrEdge: 'Axis' }, false)).toBe(true)
    expect(evaluateRequired('edge', { axisOrEdge: 'Axis' }, false)).toBe(false)
    expect(evaluateRequired('axis', { axisOrEdge: 'Edge' }, false)).toBe(false)
    expect(evaluateRequired('edge', { axisOrEdge: 'Edge' }, false)).toBe(true)
    expect(evaluateHidden('edge', { axisOrEdge: 'Edge' }, false)).toBe(false)

    expect(evaluateRequired('axis', {})).toBe(true)
    expect(evaluateRequired('edge', { edge: selectionsForArtifact() })).toBe(
      true
    )
  })

  it('shares reference options while preserving surface-specific defaults', () => {
    const { axisOrEdge, axis, angle } = config.args ?? {}
    if (
      axisOrEdge?.inputType !== 'options' ||
      axis?.inputType !== 'options' ||
      angle?.inputType !== 'kcl' ||
      typeof axisOrEdge.defaultValue !== 'function' ||
      typeof axis.defaultValue !== 'function'
    ) {
      throw new Error('Revolve reference defaults should depend on the surface')
    }

    expect(axisOrEdge.options).toEqual([
      { name: 'Sketch Axis', isCurrent: true, value: 'Axis' },
      { name: 'Edge', isCurrent: false, value: 'Edge' },
    ])
    expect(axis.options).toEqual([
      { name: 'X Axis', isCurrent: true, value: 'X' },
      { name: 'Y Axis', isCurrent: false, value: 'Y' },
    ])
    for (const useModelingDialog of [undefined, false]) {
      const context = {
        argumentsToSubmit: { edge: selectionsForArtifact() },
        selectedCommand: { useModelingDialog },
      }
      expect(axisOrEdge.defaultValue(context as never)).toBe('Axis')
      expect(axis.defaultValue(context as never)).toBeUndefined()
      expect(angle.defaultValue).toBe('360deg')
    }

    const dialogContext = {
      argumentsToSubmit: {},
      selectedCommand: { useModelingDialog: true },
    }
    expect(axis.defaultValue(dialogContext as never)).toBe('X')
  })
})

describe('Hole dialog arguments', () => {
  const config = singleCommandConfig(modelingMachineCommandConfig.Hole)
  const { evaluateHidden, evaluateRequired } = argumentConditions(config.args)

  it('defaults hidden implementation choices to a simple flat blind hole', () => {
    expect(config.args?.holeBody).toMatchObject({
      required: true,
      defaultValue: 'blind',
    })
    expect(evaluateHidden('holeBody', {})).toBe(true)
    expect(config.args?.holeType).toMatchObject({
      required: true,
      defaultValue: 'simple',
    })
    expect(config.args?.holeBottom).toMatchObject({
      required: true,
      defaultValue: 'flat',
    })
  })

  it('prepopulates dimensions only on the dialog surface', () => {
    for (const name of [
      'counterboreDepth',
      'counterboreDiameter',
      'countersinkAngle',
      'countersinkDiameter',
      'drillPointAngle',
    ] as const) {
      const prepopulate = config.args?.[name]?.prepopulate
      if (typeof prepopulate !== 'function') {
        throw new Error(`${name} should conditionally prepopulate`)
      }
      for (const useModelingDialog of [false, true]) {
        expect(
          prepopulate({
            argumentsToSubmit: {},
            selectedCommand: { useModelingDialog },
          } as never)
        ).toBe(useModelingDialog)
      }
    }
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
    expect(config.args?.countersinkHeadClearance).toMatchObject({
      defaultValue: '0',
    })
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

describe('Helix cylinder selection', () => {
  it('accepts a region-backed cylinder', () => {
    const commandConfig = modelingMachineCommandConfig.Helix
    if (!commandConfig || isArray(commandConfig)) {
      throw new Error('Helix should have a single command config')
    }

    const cylinderArg = commandConfig.args?.cylinder
    if (!cylinderArg || cylinderArg.inputType !== 'selection') {
      throw new Error('Helix should expose a cylinder selection argument')
    }

    expect(
      canSubmitSelectionArg(
        new Map<ResolvedSelectionType, number>([['pathRegion', 1]]),
        {
          inputType: 'selection',
          selectionTypes: cylinderArg.selectionTypes,
          multiple: cylinderArg.multiple,
          required: true,
        }
      )
    ).toBe(true)
  })
})

describe('Sweep-like bodyType argument', () => {
  it.each(['Extrude', 'Sweep', 'Loft', 'Revolve'] as const)(
    '%s keeps Surface available for closed profiles without requiring a body type',
    (commandName) => {
      const commandConfig = modelingMachineCommandConfig[commandName]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }
      const bodyType = commandConfig.args?.bodyType
      if (bodyType?.inputType !== 'options') {
        throw new Error(`${commandName} should expose bodyType options`)
      }

      for (const useModelingDialog of [undefined, false, true]) {
        for (const artifact of [
          { type: 'solid2d' },
          { type: 'path', subType: 'region' },
        ] as Artifact[]) {
          const context = {
            argumentsToSubmit: {
              sketches: selectionsForArtifact(artifact),
              length: parsedLength(),
            },
            selectedCommand: { useModelingDialog },
          }
          const hidden =
            typeof bodyType.hidden === 'function'
              ? bodyType.hidden(context)
              : Boolean(bodyType.hidden)
          const required =
            typeof bodyType.required === 'function'
              ? bodyType.required(context)
              : bodyType.required
          const options =
            typeof bodyType.options === 'function'
              ? bodyType.options(context)
              : bodyType.options

          expect(hidden).toBe(false)
          expect(required).toBe(false)
          expect(options).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ value: 'SURFACE' }),
              expect.objectContaining({ value: 'SOLID' }),
            ])
          )
        }
      }
    }
  )

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

describe('Sweep dialog arguments', () => {
  const config = singleCommandConfig(modelingMachineCommandConfig.Sweep)
  const { evaluateHidden } = argumentConditions(config.args)

  it('shows legacy alignment by itself when editing an old sweep', () => {
    const legacy = { nodeToEdit: [], relativeTo: 'TRAJECTORY' }
    expect(evaluateHidden('relativeTo', legacy)).toBe(false)
    expect(evaluateHidden('translateProfileToPath', legacy)).toBe(true)
    expect(evaluateHidden('orientProfilePerpendicular', legacy)).toBe(true)

    expect(evaluateHidden('relativeTo', {})).toBe(true)
    expect(evaluateHidden('translateProfileToPath', {})).toBe(false)
    expect(evaluateHidden('orientProfilePerpendicular', {})).toBe(false)
    expect(evaluateHidden('translateProfileToPath', legacy, false)).toBe(false)
  })
})

describe('Chamfer dialog arguments', () => {
  const config = singleCommandConfig(modelingMachineCommandConfig.Chamfer)
  const { evaluateHidden, evaluateRequired } = argumentConditions(config.args)

  it('leaves optional native dimensions visible without prepopulating them', () => {
    for (const argName of ['secondLength', 'angle'] as const) {
      expect(evaluateHidden(argName, {})).toBe(false)
      expect(evaluateRequired(argName, {})).toBe(false)
      expect(config.args?.[argName]?.prepopulate).toBeUndefined()
    }
  })

  it('preserves the legacy Chamfer dimension and algorithm defaults with dialogs off', () => {
    const secondLength = config.args?.secondLength
    const angle = config.args?.angle
    const version = config.args?.version
    expect(secondLength).toMatchObject({ inputType: 'kcl', defaultValue: '5' })
    expect(angle).toMatchObject({ inputType: 'kcl', defaultValue: '360deg' })
    expect(version).toMatchObject({ inputType: 'kcl', defaultValue: '1' })
  })
})

describe('Transform arguments', () => {
  it('prepopulates clearable transform values', () => {
    for (const [commandName, argName, defaultValue] of [
      ['Translate', 'x', KCL_DEFAULT_TRANSLATE_X],
      ['Rotate', 'axis', KCL_AXIS_Z],
      ['Rotate', 'angle', KCL_DEFAULT_ROTATE_ANGLE],
      ['Scale', 'factor', KCL_DEFAULT_SCALE_FACTOR],
    ] as const) {
      const commandConfig = modelingMachineCommandConfig[commandName]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }

      const args = commandConfig.args as Record<string, unknown> | undefined
      expect(args?.[argName]).toMatchObject({
        defaultValue,
        prepopulate: true,
      })
    }
  })

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
      if (
        commandName === 'Translate' ||
        commandName === 'Scale' ||
        commandName === 'Rotate'
      ) {
        expect(selectionTypes).toContain('helix')
      } else {
        expect(selectionTypes).not.toContain('helix')
      }
    }
  })

  it('does not require or show Clone variableName while editing an existing clone', () => {
    const commandConfig = modelingMachineCommandConfig.Clone
    if (!commandConfig || isArray(commandConfig)) {
      throw new Error('Clone should have a single command config')
    }

    const variableNameArg = commandConfig.args?.variableName
    if (!variableNameArg) {
      throw new Error('Clone.variableName should exist')
    }

    const creatingContext = { argumentsToSubmit: {} }
    const editingContext = { argumentsToSubmit: { nodeToEdit: [] } }
    const required =
      typeof variableNameArg.required === 'function'
        ? variableNameArg.required
        : () => variableNameArg.required
    const hidden =
      typeof variableNameArg.hidden === 'function'
        ? variableNameArg.hidden
        : () => variableNameArg.hidden

    expect(required(creatingContext)).toBe(true)
    expect(hidden(creatingContext)).toBeFalsy()
    expect(required(editingContext)).toBe(false)
    expect(hidden(editingContext)).toBe(true)
  })
})

const uniqueSorted = (values: string[]) => [...new Set(values)].sort()

const isDeprecatedStdLibArg = (
  arg: (typeof STD_LIB_COMMANDS)[keyof typeof STD_LIB_COMMANDS]['args'][number]
) => arg.deprecated || arg.deprecatedSince !== null

function pointAndClickStdLibArgs(config: StdLibCommandDriftConfig) {
  const omitted = new Set<string>(config.omittedStdLibArgs ?? [])
  const includedDeprecated = new Set<string>(config.deprecatedStdLibArgs ?? [])

  return STD_LIB_COMMANDS[config.stdLibName].args
    .filter(
      (arg) => !isDeprecatedStdLibArg(arg) || includedDeprecated.has(arg.name)
    )
    .filter((arg) => !omitted.has(arg.name))
}

describe('stdlib command arg derivation', () => {
  it('defaults stdlib-backed descriptions except the combined GDT Profile flow', () => {
    const commandNames = Object.keys(modelingCommandStdLibDriftConfig) as Array<
      keyof typeof modelingCommandStdLibDriftConfig
    >

    for (const commandName of commandNames) {
      const commandConfig = modelingMachineCommandConfig[commandName]
      if (!commandConfig || isArray(commandConfig)) {
        throw new Error(`${commandName} should have a single command config`)
      }

      const stdLibName =
        modelingCommandStdLibDriftConfig[commandName].stdLibName
      expect(stdLibCommandSummary(stdLibName)).toBeTruthy()
      expect(commandConfig.description).toBe(
        commandName === 'GDT Profile'
          ? 'Add profile geometric dimensioning & tolerancing annotation to faces or edges.'
          : stdLibCommandSummary(stdLibName)
      )
    }
  })

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
    expect(modelingStdLibCommandStatus('Delete')).toBeUndefined()
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
      ['Extrude', { sketches: selectionsForArtifact() }, false],
      ['Extrude', { direction: selectionsForArtifact() }, false],
      ['Revolve', { axis: selectionsForArtifact() }, false],
      ['Helix', { axis: selectionsForArtifact() }, false],
      ['Fillet', { edges: selectionsForArtifact() }, false],
      ['Fillet', { version: parsedLength('2') }, true],
      ['Chamfer', { edges: selectionsForArtifact() }, false],
      ['Chamfer', { version: parsedLength('2') }, true],
      ['Mirror 3D', { across: selectionsForArtifact() }, false],
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

  it('keeps the product-selected Sweep algorithm when KCL has no literal default', () => {
    const sweepCommand = modelingMachineCommandConfig.Sweep
    if (!sweepCommand || isArray(sweepCommand)) {
      throw new Error('Sweep should have a single command config')
    }

    expect(stdLibCommandArgDefaultSource('sweep', 'version')).toBeUndefined()
    expect(sweepCommand.args?.version).toMatchObject({ defaultValue: '2' })
  })
})

describe('modeling command stdlib drift', () => {
  it('covers every shared modeling codemod', () => {
    expect(Object.keys(modelingCommandStdLibDriftConfig).sort()).toEqual(
      Object.keys(modelingCommandCodemods).sort()
    )
  })

  it('validates every stdlib drift classification', () => {
    const unclassifiedArgs = Object.entries(modelingCommandStdLibDriftConfig)
      .flatMap(([commandName, driftConfig]) => {
        const config = driftConfig as StdLibCommandDriftConfig
        const omitted = new Set<string>(config.omittedStdLibArgs ?? [])
        const included = new Set<string>(config.deprecatedStdLibArgs ?? [])

        return STD_LIB_COMMANDS[config.stdLibName].args
          .filter((arg) => !arg.special && isDeprecatedStdLibArg(arg))
          .filter((arg) => !omitted.has(arg.name) && !included.has(arg.name))
          .map((arg) => `${commandName} (${config.stdLibName}).${arg.name}`)
      })
      .sort()

    expect(
      unclassifiedArgs,
      'Deprecated labeled KCL args must be listed in omittedStdLibArgs or deprecatedStdLibArgs.'
    ).toEqual([])

    for (const [commandName, driftConfig] of Object.entries(
      modelingCommandStdLibDriftConfig
    )) {
      const config = driftConfig as StdLibCommandDriftConfig
      const stdLibArgNames = new Set<string>(
        STD_LIB_COMMANDS[config.stdLibName].args.map((arg) => arg.name)
      )
      const includedDeprecated = new Set<string>(
        config.deprecatedStdLibArgs ?? []
      )
      const pointAndClickArgNames = new Set<string>(
        pointAndClickStdLibArgs(config).map((arg) => arg.name)
      )
      const configuredNames = [
        ...(config.omittedStdLibArgs ?? []),
        ...(config.deprecatedStdLibArgs ?? []),
        ...Object.keys(config.argAliases ?? {}),
      ]

      expect(
        uniqueSorted(
          configuredNames.filter((argName) => !stdLibArgNames.has(argName))
        ),
        `${commandName} has stale or misspelled KCL argument exceptions.`
      ).toEqual([])

      expect(
        (config.omittedStdLibArgs ?? []).filter((argName) =>
          includedDeprecated.has(argName)
        ),
        `${commandName} cannot both omit and include the same deprecated KCL argument.`
      ).toEqual([])

      expect(
        (config.deprecatedStdLibArgs ?? []).filter((argName) => {
          const arg = STD_LIB_COMMANDS[config.stdLibName].args.find(
            (candidate) => candidate.name === argName
          )
          return arg && !isDeprecatedStdLibArg(arg)
        }),
        `${commandName} lists active KCL arguments as deprecated.`
      ).toEqual([])

      expect(
        Object.keys(config.argAliases ?? {}).filter(
          (argName) => !pointAndClickArgNames.has(argName)
        ),
        `${commandName} aliases KCL arguments that are not exposed.`
      ).toEqual([])
    }
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

      const editFlowArgs = driftConfig.editFlow ? ['nodeToEdit'] : []
      const expectedStdLibArgOrder = pointAndClickStdLibArgs(driftConfig).map(
        (arg) => driftConfig.argAliases?.[arg.name] ?? arg.name
      )
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
              typeof prepopulate === 'function' ||
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
