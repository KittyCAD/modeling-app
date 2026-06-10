import { STD_LIB_COMMANDS } from '@rust/kcl-lib/bindings/StdLibCommands'
import { getNextAvailableDatumName } from '@src/lang/modifyAst/gdt'
import { assertParse } from '@src/lang/wasm'
import {
  type ModelingCommandSchema,
  getDefaultGdtTolerance,
  modelingMachineCommandConfig,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import {
  type StdLibCommandDriftConfig,
  modelingCommandStdLibDriftConfig,
  modelingStdLibCommandArgs,
  modelingStdLibCommandStatus,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { isArray } from '@src/lib/utils'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

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
    expect('direction' in args).toBe(false)
  })

  it('derives command status from KCL stdlib metadata', () => {
    expect(modelingStdLibCommandStatus('Helical Gear')).toBe('experimental')
    expect(modelingStdLibCommandStatus('Extrude')).toBeUndefined()
  })
})

describe('modeling command stdlib drift', () => {
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
      const editFlowArgs = driftConfig.editFlow ? ['nodeToEdit'] : []
      const expectedArgs = uniqueSorted([
        ...stdLibCommand.args
          .filter((arg) => arg.deprecatedSince === null)
          .filter((arg) => !omittedStdLibArgs.has(arg.name))
          .map((arg) => driftConfig.argAliases?.[arg.name] ?? arg.name),
        ...(driftConfig.uiOnlyArgs ?? []),
        ...editFlowArgs,
      ])
      const actualArgOrder = Object.keys(commandConfig.args ?? {})
      const actualArgs = uniqueSorted(actualArgOrder)

      expect(
        actualArgs,
        `${commandName} command args drifted from ${driftConfig.stdLibName}. Add a command arg, or document the intentional difference in modelingCommandStdLibDriftConfig.`
      ).toEqual(expectedArgs)

      if (driftConfig.requiredArgOrder) {
        const actualRequiredArgOrder = Object.entries(commandConfig.args ?? {})
          .filter(([, arg]) => {
            const { required } = arg as { required?: unknown }
            return required === true || typeof required === 'function'
          })
          .map(([argName]) => argName)

        expect(
          actualRequiredArgOrder,
          `${commandName} required command arg order drifted from the legacy command-bar order.`
        ).toEqual(driftConfig.requiredArgOrder)
      }
    }
  })
})
