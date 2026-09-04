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
  expectedModes: Partial<ModelingCommandSchema[Name]>
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
  modeArgs: readonly DialogArgName<Name>[],
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

        expect(normalized).toMatchObject(scenario.expectedModes)
        for (const modeArg of modeArgs) {
          expect(normalized).toHaveProperty(modeArg)
        }
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

runDialogContract(
  'Extrude',
  ['extentType', 'directionMode'],
  [
    {
      name: 'starts a new extrude with a one-sided distance extent',
      expectedModes: { extentType: 'distance', directionMode: 'oneSide' },
      cleared: ['to', 'symmetric', 'bidirectionalLength'],
      fields: {
        length: { hidden: false, required: true },
        to: { hidden: true, required: false },
      },
    },
    {
      name: 'derives a to-face extent and removes incompatible distance controls',
      authored: { to: 'end-face', length: '5', symmetric: true },
      expectedModes: { extentType: 'toFace', directionMode: 'oneSide' },
      cleared: ['length', 'symmetric', 'bidirectionalLength', 'direction'],
      fields: {
        length: { hidden: true, required: false },
        to: { hidden: false, required: true },
        directionMode: { hidden: true },
      },
    },
    {
      name: 'keeps only the second distance for a two-sided extent',
      authored: {
        extentType: 'distance',
        directionMode: 'twoSides',
        length: '5',
        bidirectionalLength: '3',
        to: 'stale-face',
      },
      expectedModes: { extentType: 'distance', directionMode: 'twoSides' },
      cleared: ['to', 'symmetric'],
      fields: {
        bidirectionalLength: { hidden: false, required: true },
      },
    },
  ]
)

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

runDialogContract(
  'Revolve',
  ['axisOrEdge', 'extentType', 'directionMode'],
  [
    {
      name: 'starts a new revolve as a full turn despite its seeded angle value',
      expectedModes: {
        axisOrEdge: 'Axis',
        extentType: 'full',
        directionMode: 'oneSide',
      },
      cleared: ['edge', 'angle', 'symmetric', 'bidirectionalAngle'],
      fields: {
        angle: { hidden: true, required: false },
        directionMode: { hidden: true },
      },
    },
    {
      name: 'derives an edge-axis symmetric partial revolve',
      authored: {
        edge: 'axis-edge',
        axis: 'X',
        angle: '90deg',
        symmetric: true,
      },
      expectedModes: {
        axisOrEdge: 'Edge',
        extentType: 'angle',
        directionMode: 'symmetric',
      },
      cleared: ['axis', 'bidirectionalAngle'],
      fields: {
        axis: { hidden: true, required: false },
        edge: { hidden: false, required: true },
        angle: { hidden: false, required: true },
      },
    },
    {
      name: 'removes angle controls from a full revolve',
      authored: {
        axisOrEdge: 'Axis',
        axis: 'Y',
        extentType: 'full',
        angle: '180deg',
        bidirectionalAngle: '20deg',
      },
      expectedModes: {
        axisOrEdge: 'Axis',
        extentType: 'full',
        directionMode: 'oneSide',
      },
      cleared: ['edge', 'angle', 'symmetric', 'bidirectionalAngle'],
      fields: {
        directionMode: { hidden: true },
        angle: { hidden: true, required: false },
      },
    },
  ]
)

runDialogContract(
  'Hole',
  ['holeType', 'holeBottom'],
  [
    {
      name: 'keeps a new hole simple and flat while seeding inactive dimensions',
      expectedModes: { holeType: 'simple', holeBottom: 'flat' },
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
      expectedModes: { holeType: 'counterbore', holeBottom: 'drill' },
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
  ]
)

runDialogContract(
  'Chamfer',
  ['chamferType'],
  [
    {
      name: 'starts a new chamfer with one equal distance',
      expectedModes: { chamferType: 'equalDistance' },
      cleared: ['secondLength', 'angle'],
      fields: {
        secondLength: { hidden: true, required: false },
        angle: { hidden: true, required: false },
      },
    },
    {
      name: 'derives distance-and-angle and removes a stale second distance',
      authored: { angle: '45deg', secondLength: '3' },
      expectedModes: { chamferType: 'distanceAndAngle' },
      cleared: ['secondLength'],
      fields: {
        secondLength: { hidden: true, required: false },
        angle: { hidden: false, required: true },
      },
    },
  ]
)

runDialogContract(
  'Sweep',
  ['profilePosition', 'profileOrientation'],
  [
    {
      name: 'starts a new sweep with original profile alignment',
      expectedModes: {
        profilePosition: 'original',
        profileOrientation: 'original',
      },
      expectedNormalized: {
        translateProfileToPath: false,
        orientProfilePerpendicular: false,
      },
      fields: {
        profilePosition: { hidden: false, required: true },
        profileOrientation: { hidden: false, required: true },
      },
    },
    {
      name: 'derives independent alignment modes from authored sweep flags',
      authored: {
        nodeToEdit: [],
        translateProfileToPath: true,
        orientProfilePerpendicular: false,
      },
      expectedModes: {
        profilePosition: 'path',
        profileOrientation: 'original',
      },
      expectedNormalized: {
        translateProfileToPath: true,
        orientProfilePerpendicular: false,
      },
      fields: {
        relativeTo: { hidden: true },
        profilePosition: { hidden: false, required: true },
        profileOrientation: { hidden: false, required: true },
      },
    },
    {
      name: 'preserves legacy alignment without modern mode arguments',
      authored: { nodeToEdit: [], relativeTo: 'TRAJECTORY' },
      expectedModes: {
        profilePosition: undefined,
        profileOrientation: undefined,
      },
      cleared: [
        'translateProfileToPath',
        'orientProfilePerpendicular',
        'profilePosition',
        'profileOrientation',
      ],
      fields: {
        relativeTo: { hidden: false },
        profilePosition: { hidden: true, required: false },
        profileOrientation: { hidden: true, required: false },
      },
    },
  ]
)

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
