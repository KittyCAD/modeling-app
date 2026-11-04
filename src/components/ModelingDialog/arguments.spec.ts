import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveArguments } from '@src/components/ModelingDialog/arguments'
import { getDefaultInputText } from '@src/components/ModelingDialog/defaults'
import { stdLibConstantOptions } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { createLocalName, createVariableDeclaration } from '@src/lang/create'
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
    editedArguments?: ReadonlySet<string>
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
      editedArguments
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

  it('omits declared defaults across input types using generated constant values', async () => {
    const args = {
      angle: {
        inputType: 'kcl',
        required: false,
        kclDefault: {
          value: { value: 360, suffix: 'Deg' },
          expression: '360deg',
        },
      },
      enabled: {
        inputType: 'boolean',
        required: false,
        kclDefault: { value: false, expression: 'false' },
      },
      name: {
        inputType: 'string',
        required: false,
        kclDefault: { value: 'hello', expression: '"hello"' },
      },
      bodyType: {
        inputType: 'options',
        required: false,
        options: stdLibConstantOptions(['SOLID', 'SURFACE']),
        kclDefault: { value: 'solid', expression: '"solid"' },
      },
      relativeTo: {
        inputType: 'options',
        required: false,
        options: stdLibConstantOptions(['SKETCH_PLANE', 'TRAJECTORY'], {
          module: 'sweep',
        }),
        kclDefault: {
          value: 'trajectoryCurve',
          expression: "'trajectoryCurve'",
        },
      },
    } satisfies NonNullable<Command['args']>
    const result = await resolve(args, {
      angle: '360.0deg',
      enabled: false,
      name: 'hello',
      bodyType: 'SOLID',
      relativeTo: 'TRAJECTORY',
    })
    expect(result).toEqual({
      angle: undefined,
      enabled: undefined,
      name: undefined,
      bodyType: undefined,
      relativeTo: undefined,
    })
    expect(getDefaultInputText(args.angle)).toBe('360deg')
    expect(getDefaultInputText(args.name)).toBe('hello')
  })

  it('preserves required values, other units, expressions, and new variables', async () => {
    const angle = {
      inputType: 'kcl',
      required: false,
      kclDefault: {
        value: { value: 360, suffix: 'Deg' },
        expression: '360deg',
      },
    } satisfies NonNullable<Command['args']>[string]
    const literal = await stringToKclExpression('360deg', world.rustContext)
    if (literal instanceof Error || 'errors' in literal)
      throw new Error('Could not parse angle')
    const variable = {
      ...literal,
      variableName: 'angle001',
      variableIdentifierAst: createLocalName('angle001'),
      variableDeclarationAst: createVariableDeclaration(
        'angle001',
        literal.valueAst
      ),
      insertIndex: 0,
    }
    const result = await resolve(
      {
        required: { ...angle, required: true },
        units: angle,
        expression: angle,
        variable: angle,
      },
      {
        required: '360deg',
        units: '360rad',
        expression: '180deg * 2',
        variable,
      }
    )
    assertNotErr(result)
    expect(result.required).toMatchObject({ valueText: '360deg' })
    expect(result.units).toMatchObject({ valueText: '360rad' })
    expect(result.expression).toMatchObject({ valueText: '180deg * 2' })
    expect(result.variable).toBe(variable)
  })

  it('only normalizes edited arguments in existing calls', async () => {
    const angle = {
      inputType: 'kcl',
      required: false,
      kclDefault: {
        value: { value: 360, suffix: 'Deg' },
        expression: '360deg',
      },
    } satisfies NonNullable<Command['args']>[string]
    const result = await resolve(
      { unchanged: angle, edited: angle },
      { unchanged: '360deg', edited: '360deg' },
      { nodeToEdit: ['body', 0] },
      new Set(['edited'])
    )
    assertNotErr(result)
    expect(result.unchanged).toMatchObject({ valueText: '360deg' })
    expect(result.edited).toBeUndefined()
  })
})
