import { findAllPreviousVariables } from '@src/lang/queryAst'
import type { Program, VariableMap } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { describe, expect, it } from 'vitest'

describe('findAllPreviousVariables without a source range', () => {
  it('returns every top-level variable of the requested type', () => {
    const ast = {
      body: [
        {
          type: 'VariableDeclaration',
          start: 0,
          end: 12,
          declaration: { id: { name: 'width' } },
        },
        {
          type: 'VariableDeclaration',
          start: 13,
          end: 28,
          declaration: { id: { name: 'description' } },
        },
        {
          type: 'VariableDeclaration',
          start: 29,
          end: 40,
          declaration: { id: { name: 'height' } },
        },
      ],
    } as unknown as Program
    const defaultType = {
      type: 'Default',
      angle: 'degrees',
      len: 'mm',
    } as const
    const variables = {
      width: { type: 'Number', value: 10, ty: defaultType },
      description: { type: 'String', value: 'bracket' },
      height: { type: 'Number', value: 20, ty: defaultType },
    } as unknown as VariableMap

    expect(
      findAllPreviousVariables(
        ast,
        variables,
        undefined,
        null as unknown as ModuleType
      )
    ).toEqual({
      variables: [
        { key: 'width', value: 10, ty: defaultType },
        { key: 'height', value: 20, ty: defaultType },
      ],
      bodyPath: [['body', '']],
      insertIndex: 3,
    })
  })
})
