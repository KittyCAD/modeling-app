import { describe, expect, it } from 'vitest'
import STD_LIB_COMMANDS from '@rust/kcl-lib/bindings/StdLibCommands'
import {
  acceptsNamed,
  arityOf,
  namedTypesIn,
  parseKclType,
} from '@src/lib/kclStdlib/types'

describe('parseKclType', () => {
  it('reads a named type', () => {
    expect(parseKclType('Sketch')).toEqual({ kind: 'named', name: 'Sketch' })
  })

  it('reads a number with the unit it is measured in', () => {
    expect(parseKclType('number(Length)')).toEqual({
      kind: 'number',
      unit: 'Length',
    })
    expect(parseKclType('number(Angle)')).toEqual({
      kind: 'number',
      unit: 'Angle',
    })
  })

  /** `number(_)` is "a number, unit unspecified" — the same as a bare number. */
  it('treats an unspecified unit as no unit', () => {
    expect(parseKclType('number(_)')).toEqual({ kind: 'number', unit: null })
    expect(parseKclType('number')).toEqual({ kind: 'number', unit: null })
  })

  it('reads a union', () => {
    expect(parseKclType('Plane | Face')).toEqual({
      kind: 'union',
      members: [
        { kind: 'named', name: 'Plane' },
        { kind: 'named', name: 'Face' },
      ],
    })
  })

  it('reads an array with its arity', () => {
    expect(parseKclType('[Solid; 1+]')).toEqual({
      kind: 'array',
      element: { kind: 'named', name: 'Solid' },
      arity: { min: 1, max: null },
    })
    expect(parseKclType('[Segment; 2]')).toEqual({
      kind: 'array',
      element: { kind: 'named', name: 'Segment' },
      arity: { min: 2, max: 2 },
    })
  })

  it('reads an array with no arity as any length', () => {
    expect(parseKclType('[number]')).toEqual({
      kind: 'array',
      element: { kind: 'number', unit: null },
      arity: { min: 0, max: null },
    })
  })

  /**
   * The reason splitting tracks bracket depth: this is one member of its
   * enclosing array, not three members of a union.
   */
  it('reads a nested array inside a union inside an array', () => {
    expect(parseKclType('[Sketch | [Segment; 1+]; 2+]')).toEqual({
      kind: 'array',
      element: {
        kind: 'union',
        members: [
          { kind: 'named', name: 'Sketch' },
          {
            kind: 'array',
            element: { kind: 'named', name: 'Segment' },
            arity: { min: 1, max: null },
          },
        ],
      },
      arity: { min: 2, max: null },
    })
  })

  /**
   * Total on purpose. A KCL type nobody has taught this about should make one
   * argument unfillable, not throw while a form is being built.
   */
  it('keeps whatever it does not understand', () => {
    expect(parseKclType('SomethingNew<T>')).toEqual({
      kind: 'named',
      name: 'SomethingNew<T>',
    })
  })

  /** The real corpus, which is the only test that cannot go stale. */
  it('parses every type in the generated stdlib', () => {
    const commands = Object.values(
      STD_LIB_COMMANDS as unknown as Record<
        string,
        { args: { ty: string | null }[] }
      >
    )

    const types = new Set(
      commands.flatMap((command) =>
        command.args.map((arg) => arg.ty).filter((ty): ty is string => !!ty)
      )
    )

    expect(types.size).toBeGreaterThan(70)
    for (const ty of types) {
      const parsed = parseKclType(ty)
      expect(parsed.kind).toBeDefined()
      // Nothing should parse to an empty name, which is what a mis-split looks
      // like.
      expect(namedTypesIn(parsed).every((name) => name.length > 0)).toBe(true)
    }
  })
})

describe('asking about a type', () => {
  it('finds a named type anywhere inside', () => {
    const type = parseKclType('[Sketch | Face | any; 1+]')
    expect(acceptsNamed(type, 'Sketch')).toBe(true)
    expect(acceptsNamed(type, 'Solid')).toBe(false)
  })

  it('reports the arity of a list, and nothing for a single value', () => {
    expect(arityOf(parseKclType('[Solid; 1+]'))).toEqual({
      min: 1,
      max: null,
    })
    expect(arityOf(parseKclType('Solid'))).toBeNull()
  })

  it('finds the arity through a union', () => {
    expect(arityOf(parseKclType('[Solid; 1+] | ImportedGeometry'))).toEqual({
      min: 1,
      max: null,
    })
  })
})
