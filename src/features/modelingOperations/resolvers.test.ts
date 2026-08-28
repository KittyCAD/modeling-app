import { describe, expect, it } from 'vitest'
import type { ParsedProgram } from '@src/contracts/modelingOperations'
import {
  bindingResolver,
  booleanResolver,
  expressionResolver,
  sourceResolver,
} from '@src/features/modelingOperations/resolvers'
import type { DerivedInput } from '@src/lib/kclStdlib/shapes'
import { parseKclType } from '@src/lib/kclStdlib/types'

const input = (type: string, name = 'value'): DerivedInput => ({
  name,
  type: parseKclType(type),
  docs: null,
  required: true,
  special: false,
  experimental: false,
  deprecated: false,
})

const program = { source: '', ast: { body: [] } } as unknown as ParsedProgram

const promptFor = async (type: string) => {
  const prompt = await sourceResolver.prompt({
    input: input(type),
    program,
    resolved: {},
  })
  if (prompt.kind !== 'expression') throw new Error('expected an expression')
  return prompt
}

describe('typing a value as KCL source', () => {
  /*
   * The reason it exists: without it, an axis or a plane has no resolver at all
   * and the operation is a button that cannot be finished.
   */
  it('claims the types nothing else does', () => {
    expect(sourceResolver.handles(input('Axis3d | Point3d'))).toBe(true)
    expect(sourceResolver.handles(input('Plane'))).toBe(true)
    expect(sourceResolver.handles(input('[string; 1+]'))).toBe(true)
    expect(sourceResolver.handles(input('TagDecl'))).toBe(true)
  })

  it('leaves numbers and flags to the prompts that know their shape', () => {
    expect(sourceResolver.handles(input('number(Length)'))).toBe(false)
    expect(sourceResolver.handles(input('bool'))).toBe(false)

    expect(expressionResolver.handles(input('number(Length)'))).toBe(true)
    expect(booleanResolver.handles(input('bool'))).toBe(true)
  })

  /* Offered alongside, never instead of, a resolver that knows something. */
  it('sorts after every other way of answering', () => {
    const others = [bindingResolver, expressionResolver, booleanResolver]

    for (const other of others) {
      expect(sourceResolver.order ?? 0).toBeGreaterThan(other.order ?? 0)
    }
  })

  it('shows the canonical short form of a type it knows', async () => {
    expect((await promptFor('Plane')).placeholder).toBe('XY')
    expect((await promptFor('Axis3d')).placeholder).toBe('Z')
  })

  it('shows a bracketed example for a list', async () => {
    expect((await promptFor('[string; 1+]')).placeholder).toBe('["text"]')
  })

  it('leads with the first member of a union, as KCL docs do', async () => {
    expect((await promptFor('Axis3d | Point3d')).placeholder).toBe('Z')
  })

  it('falls back to the type name, which beats an empty box', async () => {
    expect((await promptFor('Sketch')).placeholder).toBe('Sketch')
  })

  /* No unit: a plane is not measured in millimetres. */
  it('offers no unit', async () => {
    expect((await promptFor('Plane')).unit).toBeNull()
  })

  it('passes what was typed through untouched', () => {
    // No `toArgument`, so the answer is its own source — which is the point:
    // validating KCL here would be a second opinion about the grammar.
    expect(sourceResolver.toArgument).toBeUndefined()
  })
})
