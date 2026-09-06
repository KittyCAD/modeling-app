import {
  initializeDialogArguments,
  resolveDialogArguments,
} from '@src/components/ModelingDialog/ModelingDialog.arguments'
import { assertParse } from '@src/lang/wasm'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { enginelessExecutor } from '@src/lib/testHelpers'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>

beforeAll(async () => {
  world = await buildTheWorldAndNoEngineConnection()
})

beforeEach(async () => {
  const ast = assertParse(
    `point2d = [1mm, 2mm]
point3d = [1mm, 2mm, 3mm]
fn getPoint2d() { return point2d }
fn getPoint3d() { return point3d }`,
    world.instance
  )
  await enginelessExecutor(ast, world.rustContext, false)
})

function vectorContext(
  inputType: 'vector2d' | 'vector3d',
  value?: unknown
): CommandBarContext {
  return {
    commandInvocationId: 1,
    commands: [],
    argumentsToSubmit: { point: value },
    machineManager: world.machineManager,
    wasmInstancePromise: Promise.resolve(world.instance),
    selectedCommand: {
      name: 'Vector input',
      groupId: 'modeling',
      useModelingDialog: true,
      needsReview: true,
      scopes: ['mode-modeling'],
      onSubmit: () => {},
      args: { point: { inputType, required: true } },
    },
  }
}

function resolveVector(
  context: CommandBarContext,
  values: Record<string, unknown>
) {
  return resolveDialogArguments({
    context,
    values,
    wasmInstance: world.instance,
    ast: world.kclManager.astSignal.value,
    rustContext: world.rustContext,
    selectionRanges: { graphSelections: [], otherSelections: [] },
    coerceSelectionForArgument: (_arg, selection) => selection,
  })
}

describe.each(['vector2d', 'vector3d'] as const)(
  '%s dialog expressions',
  (inputType) => {
    const literal = inputType === 'vector2d' ? '[1mm, 2mm]' : '[1mm, 2mm, 3mm]'
    const variable = inputType === 'vector2d' ? 'point2d' : 'point3d'
    const call = inputType === 'vector2d' ? 'getPoint2d()' : 'getPoint3d()'

    it.each([literal, `(${literal})`, variable, call])(
      'preserves authored expression %s through initialization and submission',
      async (expression) => {
        const authored = await stringToKclExpression(
          expression,
          world.rustContext,
          { allowArrays: true }
        )
        expect(authored).toMatchObject({ valueCalculated: literal })

        const context = vectorContext(inputType, authored)
        const values = await initializeDialogArguments(context, world.instance)
        const resolved = await resolveVector(context, values)

        expect(resolved).toMatchObject({
          ok: true,
          argumentsToSubmit: {
            point: { valueText: expression, valueCalculated: literal },
          },
        })
      }
    )

    it.each(['[1mm,', '1mm, 2mm'])(
      'rejects incomplete KCL expression %s',
      async (expression) => {
        const context = vectorContext(inputType)
        expect(
          await resolveVector(context, { point: expression })
        ).toMatchObject({
          ok: false,
          reason: 'invalidExpression',
        })
      }
    )
  }
)
