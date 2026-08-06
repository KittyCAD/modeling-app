import {
  type ModelingCommandSchema,
  modelingMachineCommandConfig,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type {
  CommandArgumentConfig,
  CommandDialogLayout,
} from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { isArray } from '@src/lib/utils'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import { describe, expect, it } from 'vitest'

type DialogCommandName =
  | 'Extrude'
  | 'Sweep'
  | 'Loft'
  | 'Revolve'
  | 'Hole'
  | 'Chamfer'

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

function initializeDialogArguments(
  config: DialogCommandConfig,
  authored: Record<string, unknown>
): Record<string, unknown> {
  const commandBarArguments = { ...authored }

  // Match commandBarMachine's initial seeding of skip/prepopulate defaults.
  for (const [argName, argConfig] of Object.entries(config.args ?? {})) {
    if (Object.hasOwn(commandBarArguments, argName)) {
      continue
    }
    commandBarArguments[argName] =
      (argConfig.skip || argConfig.prepopulate) && 'defaultValue' in argConfig
        ? argConfig.defaultValue
        : undefined
  }

  // Match ModelingDialog's ordered, context-aware default resolution.
  const draft: Record<string, unknown> = {}
  for (const [argName, argConfig] of Object.entries(config.args ?? {})) {
    if (
      argConfig.inputType === 'selection' ||
      argConfig.inputType === 'selectionMixed'
    ) {
      continue
    }

    const context = {
      argumentsToSubmit: { ...commandBarArguments, ...draft },
      selectedCommand: { useModelingDialog: true },
    }
    const isRequired =
      typeof argConfig.required === 'function'
        ? argConfig.required(context)
        : argConfig.required
    const rawExistingValue = commandBarArguments[argName]
    const existingValue =
      typeof rawExistingValue === 'function'
        ? rawExistingValue(context)
        : rawExistingValue
    const shouldResolveDefault =
      isRequired ||
      Boolean(argConfig.prepopulate) ||
      Boolean(argConfig.skip) ||
      Boolean(argConfig.dialog?.prepopulate)
    const rawDefaultValue =
      existingValue === undefined &&
      shouldResolveDefault &&
      'defaultValue' in argConfig
        ? argConfig.defaultValue
        : undefined
    const defaultValue =
      typeof rawDefaultValue === 'function'
        ? rawDefaultValue(context)
        : rawDefaultValue
    const resolvedValue = existingValue ?? defaultValue

    draft[argName] =
      argConfig.inputType === 'kcl' && isKclCommandValue(resolvedValue)
        ? resolvedValue.valueText
        : resolvedValue
  }

  return { ...commandBarArguments, ...draft }
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
      it(scenario.name, () => {
        const source = {
          __dialogContractSentinel: 'preserve-me',
          ...scenario.authored,
        }
        const sourceSnapshot = structuredClone(source)
        const hydrated = initializeDialogArguments(config, source)
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
        for (const [argName, expected] of Object.entries(
          scenario.fields ?? {}
        )) {
          expect(evaluateField(config, argName, normalized)).toMatchObject(
            expected
          )
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
