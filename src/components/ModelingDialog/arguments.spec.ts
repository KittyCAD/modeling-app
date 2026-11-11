import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveArguments } from '@src/components/ModelingDialog/arguments'
import { stdLibConstantOptions } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import { stdLibCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import { assertParse } from '@src/lang/wasm'
import type { Command } from '@src/lib/commandTypes'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import {
  assertNotErr,
  buildTheWorldAndNoEngineConnection,
} from '@src/unitTestUtils'

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
    existing: Record<string, unknown> = {},
    editedOptions?: ReadonlySet<string>
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
      assertParse('@settings(kclVersion = 3.0)\nvalue = 1', world.instance),
      undefined,
      editedOptions
    )
  }

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

  it('omits matching optional choices and preserves other input types', async () => {
    const bodyType = {
      inputType: 'options',
      required: false,
      options: stdLibConstantOptions(['SOLID', 'SURFACE']),
      kclDefault:
        stdLibCommandArgs<Record<string, unknown>>('extrude').bodyType
          .kclDefault,
    } satisfies NonNullable<Command['args']>[string]
    const result = await resolve(
      {
        defaultChoice: bodyType,
        otherChoice: bodyType,
        requiredChoice: { ...bodyType, required: true },
        boolean: { inputType: 'boolean', required: false, kclDefault: false },
        angle: {
          inputType: 'kcl',
          required: false,
          kclDefault: { value: 360, suffix: 'Deg' },
        },
        text: { inputType: 'string', required: false, kclDefault: 'hello' },
      },
      {
        defaultChoice: 'SOLID',
        otherChoice: 'SURFACE',
        requiredChoice: 'SOLID',
        boolean: false,
        angle: '360deg',
        text: 'hello',
      }
    )
    assertNotErr(result)
    expect(result.defaultChoice).toBeUndefined()
    expect(result.otherChoice).toBe('SURFACE')
    expect(result.requiredChoice).toBe('SOLID')
    expect(result.boolean).toBe(false)
    expect(result.angle).toMatchObject({ valueText: '360deg' })
    expect(result.text).toBe('hello')
  })

  it('preserves untouched options and expressions when editing', async () => {
    const bodyType = {
      inputType: 'options',
      required: false,
      options: stdLibConstantOptions(['SOLID', 'SURFACE']),
      kclDefault: 'solid',
    } satisfies NonNullable<Command['args']>[string]
    const result = await resolve(
      { unchanged: bodyType, edited: bodyType, expression: bodyType },
      { unchanged: 'SOLID', edited: 'SOLID', expression: 'bodyType001' },
      { nodeToEdit: ['body', 0] },
      new Set(['edited'])
    )
    expect(result).toMatchObject({
      unchanged: 'SOLID',
      edited: undefined,
      expression: 'bodyType001',
    })
  })

  it('preserves legacy sweep modes with context-dependent defaults', async () => {
    const metadata = stdLibCommandArgs<Record<string, unknown>>('sweep', {
      includeDeprecated: ['relativeTo'],
    })
    expect(metadata.relativeTo.kclDefault).toBeUndefined()
    const result = await resolve(
      {
        relativeTo: {
          inputType: 'options',
          required: false,
          options: stdLibConstantOptions(['SKETCH_PLANE', 'TRAJECTORY'], {
            module: 'sweep',
          }),
          kclDefault: metadata.relativeTo.kclDefault,
        },
      },
      { relativeTo: 'TRAJECTORY' },
      { nodeToEdit: ['body', 0], version: 2, relativeTo: 'SKETCH_PLANE' },
      new Set(['relativeTo'])
    )
    expect(result).toMatchObject({ version: 2, relativeTo: 'TRAJECTORY' })
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
