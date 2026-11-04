import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveArguments } from '@src/components/ModelingDialog/arguments'
import { getDefaultInputText } from '@src/components/ModelingDialog/defaults'
import { stdLibConstantOptions } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import { stdLibCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import { modelingMachineCommandConfig } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { createLocalName, createVariableDeclaration } from '@src/lang/create'
import { assertParse, recast } from '@src/lang/wasm'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { addScale, addTranslate } from '@src/lang/modifyAst/transforms'
import { addSweep } from '@src/lang/modifyAst/sweeps'
import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'
import { isArray } from '@src/lib/utils'
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
    editedArguments?: ReadonlySet<string>,
    preserveDefaultArguments?: Command['preserveDefaultArguments']
  ) {
    const command: Command = {
      name: 'Test command',
      groupId: 'modeling',
      scopes: GLOBAL_COMMAND_SCOPES,
      useModelingDialog: true,
      needsReview: false,
      onSubmit: () => undefined,
      args,
      preserveDefaultArguments,
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
    } satisfies NonNullable<Command['args']>
    const result = await resolve(args, {
      angle: '360.0deg',
      enabled: false,
      name: 'hello',
      bodyType: 'SOLID',
    })
    expect(result).toEqual({
      angle: undefined,
      enabled: undefined,
      name: undefined,
      bodyType: undefined,
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

  it.each(['Translate', 'Scale'])(
    'preserves default components for %s creation and editing',
    async (commandName) => {
      const isScale = commandName === 'Scale'
      const name = isScale ? 'scale' : 'translate'
      const metadata = stdLibCommandArgs<Record<string, unknown>>(name)
      const config = isScale
        ? modelingMachineCommandConfig.Scale
        : modelingMachineCommandConfig.Translate
      if (!config || isArray(config))
        throw new Error(`Missing ${commandName} command`)
      const args = {
        x: {
          inputType: 'kcl',
          required: false,
          kclDefault: metadata.x.kclDefault,
        },
      } satisfies NonNullable<Command['args']>
      const value = isScale ? '1' : '0'
      const ast = assertParse(
        `@settings(kclVersion = 3.0)
s = sketch(on = XY) {
  c = circle(start = [var 1mm, var 0mm], center = [var 0mm, var 0mm])
}
r = region(segments = [s.c])
body001 = extrude(r, length = 1mm)
transformed = ${name}(body001, x = 2)`,
        world.instance
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      for (const existing of [{}, { nodeToEdit }]) {
        const resolved = await resolve(
          args,
          { x: value },
          existing,
          new Set(['x']),
          config.preserveDefaultArguments
        )
        assertNotErr(resolved)
        expect(resolved.x).toMatchObject({ valueText: value })
        const add = isScale ? addScale : addTranslate
        const result = add({
          ast,
          objects: { graphSelections: [], otherSelections: [] },
          artifactGraph: new Map(),
          wasmInstance: world.instance,
          nodeToEdit,
          x: isKclCommandValue(resolved.x) ? resolved.x : undefined,
        })
        assertNotErr(result)
        expect(recast(result.modifiedAst, world.instance)).toContain(
          `${name}(body001, x = ${value})`
        )
        expect(
          await mockExecAstAndReportErrors(
            result.modifiedAst,
            world.rustContext
          )
        ).toBeUndefined()
      }
    }
  )

  it('preserves an explicit trajectory mode when editing an algorithm-v2 legacy sweep', async () => {
    const metadata = stdLibCommandArgs<Record<string, unknown>>('sweep', {
      includeDeprecated: ['relativeTo'],
    })
    expect(metadata.relativeTo.kclDefault).toBeUndefined()
    const args = {
      relativeTo: {
        inputType: 'options',
        required: false,
        options: stdLibConstantOptions(['SKETCH_PLANE', 'TRAJECTORY'], {
          module: 'sweep',
        }),
        kclDefault: metadata.relativeTo.kclDefault,
      },
      version: { inputType: 'kcl', required: false },
    } satisfies NonNullable<Command['args']>
    const ast = assertParse(
      '@settings(kclVersion = 2.0)\nresult = sweep(profile, path = trajectory, relativeTo = sweep::SKETCH_PLANE, version = 2)',
      world.instance
    )
    const nodeToEdit = createPathToNodeForLastVariable(ast)
    const resolved = await resolve(
      args,
      { relativeTo: 'TRAJECTORY', version: '2' },
      { nodeToEdit, relativeTo: 'SKETCH_PLANE' },
      new Set(['relativeTo'])
    )
    assertNotErr(resolved)
    expect(resolved.relativeTo).toBe('TRAJECTORY')
    const result = addSweep({
      ast,
      artifactGraph: new Map(),
      sketches: { graphSelections: [], otherSelections: [] },
      path: { graphSelections: [], otherSelections: [] },
      wasmInstance: world.instance,
      nodeToEdit,
      relativeTo:
        resolved.relativeTo === 'TRAJECTORY' ? resolved.relativeTo : undefined,
      version: isKclCommandValue(resolved.version)
        ? resolved.version
        : undefined,
    })
    assertNotErr(result)
    const code = recast(result.modifiedAst, world.instance)
    expect(code).toContain('version = 2')
    expect(code).toContain('relativeTo = sweep::TRAJECTORY')
  })
})
