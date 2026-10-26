import {
  resolveArguments,
  updateKclArgument,
} from '@src/components/ModelingDialog/arguments'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { assertParse } from '@src/lang/wasm'
import type { Command } from '@src/lib/commandTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import {
  assertNotErr,
  buildTheWorldAndNoEngineConnection,
} from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

function faceSelection(entityId: string): Selections {
  return {
    graphSelections: [],
    otherSelections: [
      {
        type: 'enginePrimitive',
        entityId,
        primitiveType: 'face',
        primitiveIndex: 0,
      },
    ],
  }
}

describe('resolveArguments', () => {
  let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>

  beforeAll(async () => {
    world = await buildTheWorldAndNoEngineConnection()
  })

  afterAll(() => {
    world.commandBarActor.stop()
    world.settingsActor.stop()
    world.engineCommandManager.tearDown({
      route: 'user-requested',
      initiatedBy: 'client',
    })
  })

  async function resolve(
    args: NonNullable<Command['args']>,
    draft: Record<string, unknown>,
    existing: Record<string, unknown> = {}
  ) {
    const command: Command = {
      name: 'Test command',
      groupId: 'modeling',
      scopes: GLOBAL_COMMAND_SCOPES,
      useModelingDialog: true,
      needsReview: false,
      onSubmit: () => undefined,
      args,
    }
    return resolveArguments(
      {
        ...world.commandBarActor.getSnapshot().context,
        selectedCommand: command,
        argumentsToSubmit: existing,
      },
      draft,
      world.rustContext,
      assertParse('@settings(kclVersion = 3.0)\nvalue = 1', world.instance)
    )
  }

  it('keeps a newer edit when an earlier calculation reports its result', async () => {
    const arg = { inputType: 'kcl', required: true } as const
    const oldResult = await stringToKclExpression('5', world.rustContext)
    const newResult = await stringToKclExpression('1', world.rustContext)
    assertNotErr(oldResult)
    assertNotErr(newResult)
    if ('errors' in oldResult || 'errors' in newResult)
      throw new Error('Unable to calculate test expressions')

    const edited = updateKclArgument({ radius: oldResult }, 'radius', arg, {
      source: 'edit',
      value: '1',
    })
    const afterOldResult = updateKclArgument(edited, 'radius', arg, {
      source: 'calculation',
      value: oldResult,
    })
    expect(afterOldResult.radius).toBe('1')
    const current = updateKclArgument(afterOldResult, 'radius', arg, {
      source: 'calculation',
      value: newResult,
    })
    const submitted = await resolve({ radius: arg }, current)
    assertNotErr(submitted)
    expect(submitted.radius).toEqual(newResult)
  })

  it('drops inactive creation drafts but preserves static metadata', async () => {
    const result = await resolve(
      {
        name: { inputType: 'string', required: true },
        inactive: {
          inputType: 'kcl',
          required: true,
          hidden: () => true,
        },
        metadata: {
          inputType: 'string',
          required: false,
          hidden: true,
        },
      },
      {
        name: 'Example',
        inactive: 'invalid expression(',
      },
      {
        metadata: 'keep me',
        undeclaredMetadata: 'keep me too',
      }
    )

    expect(result).toEqual({
      name: 'Example',
      inactive: undefined,
      metadata: 'keep me',
      undeclaredMetadata: 'keep me too',
    })
  })

  it('preserves hidden edit metadata and original read-only selections', async () => {
    const original = faceSelection('original')
    const replacement = faceSelection('replacement')
    const nodeToEdit = ['body', 0]

    const result = await resolve(
      {
        selection: {
          inputType: 'selection',
          required: true,
          multiple: false,
          // Preserve existing references even when the creation collector
          // accepts a different selection type.
          selectionTypes: ['segment'],
        },
        hiddenMetadata: {
          inputType: 'kcl',
          required: true,
          hidden: () => true,
        },
      },
      { selection: replacement },
      {
        nodeToEdit,
        selection: original,
        hiddenMetadata: 'preserve this without parsing(',
      }
    )

    assertNotErr(result)
    expect(result.nodeToEdit).toEqual(nodeToEdit)
    expect(result.hiddenMetadata).toBe('preserve this without parsing(')
    expect(result.selection).toBe(original)
  })

  it('validates visible inputs and omits blank optional values', async () => {
    const args = {
      amount: { inputType: 'kcl', required: true },
      optional: { inputType: 'kcl', required: false },
    } satisfies NonNullable<Command['args']>

    expect(await resolve(args, { amount: ' ', optional: '' })).toBeInstanceOf(
      Error
    )
    expect(await resolve(args, { amount: '5 +', optional: '' })).toBeInstanceOf(
      Error
    )

    const result = await resolve(args, { amount: '5mm', optional: ' ' })

    assertNotErr(result)
    expect(result.amount).toMatchObject({
      valueText: '5mm',
      valueAst: { type: 'Literal' },
    })
    expect(result.optional).toBeUndefined()
  })
})
