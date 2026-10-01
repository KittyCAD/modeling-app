import {
  initializeDialogArguments,
  reconcileDialogArguments,
} from '@src/components/ModelingDialog/ModelingDialog.arguments'
import { MachineManager } from '@src/lib/MachineManager'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { modelingMachineCommandConfig } from '@src/lib/commandBarConfigs/modelingCommandConfig'
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

describe('composite dialog defaults', () => {
  it.each([
    {
      command: 'Appearance',
      authored: {},
      expected: { color: '#ffffff' },
    },
    {
      command: 'Appearance',
      authored: { nodeToEdit: [], color: '#ff0000' },
      expected: { color: '#ff0000' },
    },
    {
      command: 'Revolve',
      authored: {
        edge: 'axis-edge',
        axis: 'X',
        angle: '90deg',
        symmetric: true,
      },
      expected: {
        axisOrEdge: 'Edge',
        axis: undefined,
        angle: '90deg',
        symmetric: true,
      },
    },
    {
      command: 'Hole',
      authored: {},
      expected: {
        holeBody: 'blind',
        holeType: 'simple',
        holeBottom: 'flat',
        counterboreDepth: undefined,
        counterboreDiameter: undefined,
        countersinkAngle: undefined,
        countersinkDiameter: undefined,
        countersinkHeadClearance: undefined,
        drillPointAngle: undefined,
      },
    },
    {
      command: 'Hole',
      authored: {
        holeType: 'counterbore',
        holeBottom: 'drill',
        counterboreDepth: '1',
        counterboreDiameter: '2',
        drillPointAngle: '110deg',
      },
      expected: {
        holeBody: 'blind',
        holeType: 'counterbore',
        holeBottom: 'drill',
        counterboreDepth: '1',
        counterboreDiameter: '2',
        drillPointAngle: '110deg',
        countersinkAngle: undefined,
        countersinkDiameter: undefined,
        countersinkHeadClearance: undefined,
      },
    },
  ] as const)(
    'initializes $command from $authored',
    async ({ command, authored, expected }) => {
      const source = structuredClone(authored)
      const context = dialogContext(getDialogCommandConfig(command), source)
      const initialized = await initializeDialogArguments(context, instance)
      const normalized = reconcileDialogArguments(context, initialized)

      expect(normalized).toMatchObject(expected)
      expect(source).toEqual(authored)
      expect(reconcileDialogArguments(context, normalized)).toEqual(normalized)
    }
  )
})

describe('Export dialog dependencies', () => {
  it('reconciles storage when the format changes and clears incompatible hidden values', async () => {
    const context = dialogContext(getDialogCommandConfig('Export'), {})
    let values = await initializeDialogArguments(context, instance)
    expect(values).toMatchObject({ type: 'gltf', storage: 'binary' })

    values = { ...values, storage: 'embedded' }
    values = reconcileDialogArguments(context, { ...values, type: 'stl' })
    expect(values).toMatchObject({ type: 'stl', storage: 'ascii' })

    values = reconcileDialogArguments(context, { ...values, storage: 'binary' })
    expect(values.storage).toBe('binary')
    values = reconcileDialogArguments(context, { ...values, type: 'ply' })
    expect(values.storage).toBe('ascii')

    values = reconcileDialogArguments(context, { ...values, type: 'step' })
    expect(values.storage).toBeUndefined()
    values = reconcileDialogArguments(context, { ...values, type: 'gltf' })
    expect(values.storage).toBe('binary')
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
