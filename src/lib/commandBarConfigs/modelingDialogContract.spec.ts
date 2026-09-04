import {
  initializeDialogArguments,
  reconcileDialogArguments,
} from '@src/components/ModelingDialog/ModelingDialog.arguments'
import { MachineManager } from '@src/lib/MachineManager'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import {
  type ModelingCommandSchema,
  modelingMachineCommandConfig,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type {
  CommandArgumentConfig,
  CommandDialogLayout,
} from '@src/lib/commandTypes'
import { isArray } from '@src/lib/utils'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import { beforeAll, describe, expect, it } from 'vitest'

let instance: ModuleType
beforeAll(async () => {
  ;({ instance } = await buildTheWorldAndNoEngineConnection())
})

type DialogCommandName =
  | 'Extrude'
  | 'Sweep'
  | 'Loft'
  | 'Revolve'
  | 'Hole'
  | 'Chamfer'
  | 'Appearance'
  | 'Export'

type DialogArgName<Name extends DialogCommandName> = Extract<
  keyof ModelingCommandSchema[Name],
  string
>

type DialogFieldExpectation = {
  hidden: boolean
  required?: boolean
}

type DialogScenario<Name extends DialogCommandName> = {
  name: string
  authored?: Record<string, unknown>
  expectedValues: Partial<ModelingCommandSchema[Name]>
  expectedNormalized?: Record<string, unknown>
  cleared?: readonly DialogArgName<Name>[]
  fields?: Partial<Record<DialogArgName<Name>, DialogFieldExpectation>>
}

type DialogCommandConfig = {
  args?: Record<string, CommandArgumentConfig<unknown, ModelingMachineContext>>
  dialogLayout?: CommandDialogLayout
}

function getDialogCommandConfig(name: DialogCommandName): DialogCommandConfig {
  const config = modelingMachineCommandConfig[name]
  if (!config || isArray(config)) {
    throw new Error(`${name} should have a single command config`)
  }
  return config as unknown as DialogCommandConfig
}

function dialogContext(
  config: DialogCommandConfig,
  argumentsToSubmit: Record<string, unknown>
): CommandBarContext {
  return {
    argumentsToSubmit,
    commandInvocationId: 1,
    commands: [],
    machineManager: new MachineManager(),
    wasmInstancePromise: Promise.resolve(instance),
    selectedCommand: {
      ...config,
      name: 'Contract test',
      groupId: 'modeling',
      useModelingDialog: true,
      scopes: ['mode-modeling'],
      needsReview: true,
      onSubmit: () => {},
    },
  }
}

function evaluateField(
  config: DialogCommandConfig,
  argName: string,
  argumentsToSubmit: Record<string, unknown>
): DialogFieldExpectation {
  const argConfig = config.args?.[argName]
  if (!argConfig) {
    throw new Error(`Missing dialog argument ${argName}`)
  }
  const context = {
    argumentsToSubmit,
    selectedCommand: { useModelingDialog: true },
  }

  return {
    hidden:
      typeof argConfig.hidden === 'function'
        ? argConfig.hidden(context)
        : Boolean(argConfig.hidden),
    required:
      typeof argConfig.required === 'function'
        ? argConfig.required(context)
        : argConfig.required,
  }
}

function runDialogContract<Name extends DialogCommandName>(
  commandName: Name,
  scenarios: readonly DialogScenario<Name>[]
) {
  describe(`${commandName} dialog contract`, () => {
    const config = getDialogCommandConfig(commandName)
    const normalize = (draft: Record<string, unknown>) =>
      config.dialogLayout?.normalizeArguments?.(draft) ?? { ...draft }

    for (const scenario of scenarios) {
      it(scenario.name, async () => {
        const source = {
          __dialogContractSentinel: 'preserve-me',
          ...scenario.authored,
        }
        const sourceSnapshot = structuredClone(source)
        const hydrated = await initializeDialogArguments(
          dialogContext(config, source),
          instance
        )
        const normalized = normalize(hydrated)

        expect(normalized).toMatchObject(scenario.expectedValues)
        if (scenario.expectedNormalized) {
          expect(normalized).toMatchObject(scenario.expectedNormalized)
        }
        for (const argName of scenario.cleared ?? []) {
          expect(normalized).toHaveProperty(argName, undefined)
        }
        for (const [argName, expected] of Object.entries<
          DialogFieldExpectation | undefined
        >(scenario.fields ?? {})) {
          if (expected) {
            expect(evaluateField(config, argName, normalized)).toMatchObject(
              expected
            )
          }
        }

        expect(source).toEqual(sourceSnapshot)
        expect(normalized.__dialogContractSentinel).toBe('preserve-me')
        expect(normalize(normalized)).toEqual(normalized)
      })
    }
  })
}

describe('native modeling arguments', () => {
  it.each([
    { name: 'Extrude', values: { length: '5', symmetric: true } },
    {
      name: 'Revolve',
      values: { axis: 'Y', angle: '90deg', bidirectionalAngle: '20deg' },
    },
    {
      name: 'Sweep',
      values: {
        translateProfileToPath: true,
        orientProfilePerpendicular: false,
      },
    },
    { name: 'Chamfer', values: { length: '5', angle: '45deg' } },
  ] as const)(
    'preserves authored $name fields through initialization',
    async ({ name, values }) => {
      const source = { nodeToEdit: [], ...values }
      const snapshot = structuredClone(source)
      const context = dialogContext(getDialogCommandConfig(name), source)
      const initialized = await initializeDialogArguments(context, instance)

      expect(reconcileDialogArguments(context, initialized)).toMatchObject(
        values
      )
      expect(source).toEqual(snapshot)
    }
  )

  it.each([
    {
      name: 'Extrude',
      authored: {
        to: {
          graphSelections: [{ codeRef: { range: [0, 1, 0], pathToNode: [] } }],
          otherSelections: [],
        },
      },
      omitted: { length: '', symmetric: undefined, bidirectionalLength: '' },
    },
    {
      name: 'Revolve',
      authored: { axisOrEdge: 'Axis', axis: 'Y' },
      omitted: { angle: '', symmetric: undefined, bidirectionalAngle: '' },
    },
    {
      name: 'Sweep',
      authored: { relativeTo: 'TRAJECTORY' },
      omitted: {
        translateProfileToPath: undefined,
        orientProfilePerpendicular: undefined,
      },
    },
    {
      name: 'Chamfer',
      authored: { length: '5' },
      omitted: { secondLength: '', angle: '' },
    },
  ] as const)(
    'does not invent omitted $name values while editing',
    async ({ name, authored, omitted }) => {
      const context = dialogContext(getDialogCommandConfig(name), {
        nodeToEdit: [],
        ...authored,
      })
      const initialized = await initializeDialogArguments(context, instance)

      expect(reconcileDialogArguments(context, initialized)).toMatchObject(
        omitted
      )
    }
  )
})

describe('Loft dialog contract', () => {
  const config = getDialogCommandConfig('Loft')

  it('keeps ordered profiles as the primary workflow', () => {
    expect(config.dialogLayout?.groups.map((group) => group.id)).toEqual([
      'profiles',
      'result',
      'advanced',
    ])
    expect(config.args?.sketches.dialog).toMatchObject({
      group: 'profiles',
      compactSelection: true,
      orderedSelection: true,
    })
  })
})

runDialogContract('Appearance', [
  {
    name: 'initializes the displayed white color as a real argument',
    expectedValues: { color: '#ffffff' },
  },
  {
    name: 'preserves the authored color when editing',
    authored: { nodeToEdit: [], color: '#ff0000' },
    expectedValues: { color: '#ff0000' },
  },
])

runDialogContract('Revolve', [
  {
    name: 'retains the existing edge-axis selector without replacing native angle fields',
    authored: {
      edge: 'axis-edge',
      axis: 'X',
      angle: '90deg',
      symmetric: true,
    },
    expectedValues: { axisOrEdge: 'Edge' },
    expectedNormalized: { angle: '90deg', symmetric: true },
    cleared: ['axis'],
    fields: {
      axis: { hidden: true, required: false },
      edge: { hidden: false, required: true },
      angle: { hidden: false, required: false },
    },
  },
])

runDialogContract('Hole', [
  {
    name: 'keeps a new hole simple and flat while seeding inactive dimensions',
    expectedValues: { holeType: 'simple', holeBottom: 'flat' },
    expectedNormalized: { holeBody: 'blind' },
    cleared: [
      'counterboreDepth',
      'counterboreDiameter',
      'countersinkAngle',
      'countersinkDiameter',
      'countersinkHeadClearance',
      'drillPointAngle',
    ],
    fields: {
      counterboreDepth: { hidden: true, required: false },
      countersinkAngle: { hidden: true, required: false },
      drillPointAngle: { hidden: true, required: false },
    },
  },
  {
    name: 'preserves an authored counterbore with a drill-point bottom',
    authored: {
      holeType: 'counterbore',
      holeBottom: 'drill',
      counterboreDepth: '1',
      counterboreDiameter: '2',
      drillPointAngle: '110deg',
    },
    expectedValues: { holeType: 'counterbore', holeBottom: 'drill' },
    expectedNormalized: { holeBody: 'blind' },
    cleared: [
      'countersinkAngle',
      'countersinkDiameter',
      'countersinkHeadClearance',
    ],
    fields: {
      counterboreDepth: { hidden: false, required: true },
      countersinkAngle: { hidden: true, required: false },
      drillPointAngle: { hidden: false, required: true },
    },
  },
])

describe('Export dialog dependencies', () => {
  it('reconciles storage when the format changes and clears incompatible hidden values', async () => {
    const context = dialogContext(getDialogCommandConfig('Export'), {})
    let values = await initializeDialogArguments(context, instance)
    expect(values).toMatchObject({ type: 'gltf', storage: 'embedded' })

    values = reconcileDialogArguments(context, { ...values, type: 'stl' })
    expect(values).toMatchObject({ type: 'stl', storage: 'ascii' })

    values = reconcileDialogArguments(context, { ...values, storage: 'binary' })
    expect(values.storage).toBe('binary')
    values = reconcileDialogArguments(context, { ...values, type: 'ply' })
    expect(values.storage).toBe('ascii')

    values = reconcileDialogArguments(context, { ...values, type: 'step' })
    expect(values.storage).toBeUndefined()
    values = reconcileDialogArguments(context, { ...values, type: 'gltf' })
    expect(values.storage).toBe('embedded')
  })

  it('preserves a selected storage format supported by both formats', async () => {
    const context = dialogContext(getDialogCommandConfig('Export'), {
      type: 'gltf',
      storage: 'binary',
    })
    const initial = await initializeDialogArguments(context, instance)
    expect(
      reconcileDialogArguments(context, { ...initial, type: 'stl' }).storage
    ).toBe('binary')
  })
})
