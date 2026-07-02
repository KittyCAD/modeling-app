import { getNextAvailableDatumName } from '@src/lang/modifyAst/gdt'
import { type Artifact, assertParse } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import {
  type ModelingCommandSchema,
  extrudeSelectionRequiresBodyType,
  getDefaultGdtTolerance,
  modelingMachineCommandConfig,
  profileSelectionRequiresBodyType,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import {
  type StdLibCommandDriftConfig,
  modelingCommandStdLibDriftConfig,
  modelingStdLibCommandArgs,
  modelingStdLibCommandStatus,
  modelingStdLibCommandUsesExperimentalFeatures,
  stdLibCommandStatus,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import { STD_LIB_COMMANDS } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import type {
  CommandArgumentConfig,
  KclCommandValue,
} from '@src/lib/commandTypes'
import { isArray } from '@src/lib/utils'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'
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

describe('Extrude bodyType argument', () => {
  it('requires bodyType when extruding sketch segments after length is confirmed', () => {
    expect(
      bodyTypeRequiredForCommand('Extrude', {
        sketches: selectionsForArtifact({ type: 'segment' } as Artifact),
        length: parsedLength(),
      })
    ).toBe(true)
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

describe('Sweep-like bodyType argument', () => {
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
      inputType: 'kcl',
      required: false,
      status: 'experimental',
    })
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
      ['Extrude', { direction: selectionsForArtifact() }, true],
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
