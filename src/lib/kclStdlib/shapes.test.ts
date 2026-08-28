import { describe, expect, it } from 'vitest'
import {
  commandsReturning,
  derivedInputs,
  specialInput,
  stdLibCommand,
} from '@src/lib/kclStdlib/shapes'

const extrude = () => {
  const command = stdLibCommand('extrude')
  if (!command) throw new Error('extrude is missing from the stdlib shapes')
  return command
}

describe('the generated shapes', () => {
  it('finds a command by name, and admits when there is none', () => {
    expect(stdLibCommand('extrude')?.qualName).toBe('std::sketch::extrude')
    expect(stdLibCommand('definitelyNotAKclFunction')).toBeUndefined()
  })

  it('finds the commands that produce a type', () => {
    const names = commandsReturning('Sketch').map((command) => command.name)
    expect(names).toContain('startProfile')
    expect(names).toContain('circle')
    expect(names).not.toContain('abs')
  })
})

describe('deriving an operation’s inputs', () => {
  /**
   * `extrude` has fifteen arguments and a useful flow asks for two. Which two is
   * a product decision, so it is annotation; that only *these* two appear is the
   * rule.
   */
  it('takes the required arguments and the ones asked for', () => {
    const inputs = derivedInputs(extrude(), { prompt: ['length'] })

    expect(inputs.map((input) => input.name)).toEqual(['sketches', 'length'])
  })

  it('takes only the required ones when nothing is asked for', () => {
    expect(derivedInputs(extrude()).map((input) => input.name)).toEqual([
      'sketches',
    ])
  })

  it('puts the required arguments first, then the asked-for ones in order', () => {
    const inputs = derivedInputs(extrude(), {
      prompt: ['symmetric', 'length'],
    })

    expect(inputs.map((input) => input.name)).toEqual([
      'sketches',
      'symmetric',
      'length',
    ])
  })

  /**
   * A new optional argument appearing in kcl-lib must not silently appear in a
   * flow, and a newly deprecated one must not silently vanish from one.
   */
  it('leaves experimental and deprecated arguments out unless named', () => {
    const quiet = derivedInputs(extrude(), { prompt: ['length'] })
    expect(quiet.map((input) => input.name)).not.toContain('draftAngle')

    const loud = derivedInputs(extrude(), { prompt: ['draftAngle'] })
    expect(loud.map((input) => input.name)).toContain('draftAngle')
  })

  it('can drop even a required argument, for an operation that supplies it', () => {
    expect(
      derivedInputs(extrude(), { omit: ['sketches'] }).map((i) => i.name)
    ).toEqual([])
  })

  it('parses each argument’s type on the way through', () => {
    const [sketches, length] = derivedInputs(extrude(), { prompt: ['length'] })

    expect(sketches.type.kind).toBe('array')
    expect(length.type).toEqual({ kind: 'number', unit: 'Length' })
    expect(length.docs).toContain('How far to extrude')
  })

  /** One special argument, always: it is what the operation acts on. */
  it('names the argument the operation acts on', () => {
    const inputs = derivedInputs(extrude(), { prompt: ['length'] })
    expect(specialInput(inputs)?.name).toBe('sketches')
  })
})
