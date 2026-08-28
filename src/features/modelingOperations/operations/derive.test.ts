import type { Program } from '@rust/kcl-lib/bindings/Program'
import { describe, expect, it } from 'vitest'
import type { ResolvedInputs } from '@src/contracts/modelingOperations'
import { derivedOperation } from '@src/features/modelingOperations/operations/derive'
import type { OperationSpec } from '@src/features/modelingOperations/operations/derive'
import { derivedInputs, stdLibCommand } from '@src/lib/kclStdlib/shapes'

/**
 * `plan` reads the source for its offset and the AST for names in use. Neither
 * needs a real parse, and a real parse needs the WASM module.
 */
const program = (source: string, names: readonly string[] = []) => ({
  source,
  ast: {
    body: names.map((name) => ({
      type: 'VariableDeclaration',
      declaration: { id: { name }, init: { type: 'PipeExpression', body: [] } },
      start: 0,
      end: source.length,
    })),
  } as unknown as Program,
})

const plan = (
  spec: OperationSpec,
  resolved: ResolvedInputs,
  source = '',
  names: readonly string[] = []
) => {
  const operation = derivedOperation(spec)
  const command = stdLibCommand(spec.stdlib)
  if (!command) throw new Error(`no shape for ${spec.stdlib}`)

  return operation.plan({
    command,
    inputs: derivedInputs(command, operation.annotations),
    resolved,
    program: program(source, names),
    path: 'main.kcl',
  })
}

const EXTRUDE: OperationSpec = {
  stdlib: 'extrude',
  title: 'Extrude',
  past: 'Extruded',
  prompt: ['length'],
}

describe('an operation derived from a stdlib function', () => {
  it('takes its id from the function it derives from', () => {
    expect(derivedOperation(EXTRUDE).id).toBe('modeling.extrude')
    expect(derivedOperation({ ...EXTRUDE, stdlib: 'gdt::flatness' }).id).toBe(
      'modeling.gdt.flatness'
    )
  })

  it('writes the special argument unlabelled and the rest by name', async () => {
    const edit = await plan(EXTRUDE, {
      sketches: { source: 'region001' },
      length: { source: '12' },
    })

    expect(edit.changes['main.kcl'][0].insert).toBe(
      'extrude001 = extrude(region001, length = 12)\n'
    )
  })

  it('leaves out an argument that was skipped', async () => {
    const edit = await plan(EXTRUDE, { sketches: { source: 'region001' } })

    expect(edit.changes['main.kcl'][0].insert).toBe(
      'extrude001 = extrude(region001)\n'
    )
  })

  it('numbers around names already in the program', async () => {
    const edit = await plan(
      EXTRUDE,
      { sketches: { source: 'region001' } },
      'extrude001 = 1\n',
      ['extrude001', 'extrude002']
    )

    expect(edit.changes['main.kcl'][0].insert).toContain('extrude003 = ')
  })

  it('takes the variable stem from the spec when the function name is wrong for it', async () => {
    const edit = await plan(
      {
        stdlib: 'offsetPlane',
        title: 'Offset plane',
        past: 'Offset',
        stem: 'plane',
      },
      { plane: { source: 'XY' }, offset: { source: '10' } }
    )

    expect(edit.changes['main.kcl'][0].insert).toBe(
      'plane001 = offsetPlane(XY, offset = 10)\n'
    )
  })

  /* A module function's callee is qualified in source, and has no special arg. */
  it('writes a qualified call for a module function', async () => {
    const edit = await plan(
      {
        stdlib: 'gdt::flatness',
        title: 'Flatness',
        past: 'Added a flatness callout',
        stem: 'flatness',
      },
      { faces: { source: 'topFace' }, tolerance: { source: '0.1' } }
    )

    expect(edit.changes['main.kcl'][0].insert).toBe(
      'flatness001 = gdt::flatness(faces = topFace, tolerance = 0.1)\n'
    )
  })

  it('appends, and starts a line when the file does not end with one', async () => {
    const edit = await plan(
      EXTRUDE,
      { sketches: { source: 'region001' } },
      'x = 1'
    )
    const change = edit.changes['main.kcl'][0]

    expect(change).toMatchObject({ from: 5, to: 5 })
    expect(change.insert.startsWith('\n')).toBe(true)
  })

  it('does not add a blank line to a file that already ends with one', async () => {
    const edit = await plan(
      EXTRUDE,
      { sketches: { source: 'region001' } },
      'x = 1\n'
    )

    expect(edit.changes['main.kcl'][0].insert.startsWith('\n')).toBe(false)
  })
})

describe('what a derived edit calls itself', () => {
  it('names what it acted on', async () => {
    const edit = await plan(EXTRUDE, {
      sketches: { source: 'region001' },
      length: { source: '12' },
    })

    expect(edit.label).toBe('Extruded region001')
  })

  /* An operation with no special argument still has to say what it did. */
  it('stands alone when there is nothing it acted on', async () => {
    const edit = await plan(
      {
        stdlib: 'gdt::note',
        title: 'Note',
        past: 'Added a note',
        stem: 'note',
      },
      { note: { source: '"deburr all edges"' } }
    )

    expect(edit.label).toBe('Added a note')
  })
})
