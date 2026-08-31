import { describe, expect, it } from 'vitest'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { TextEdit } from '@src/contracts/modelingOperations'
import { addHide, removeHide } from '@src/features/featureTree/hideEdit'

/** Apply edits back-to-front, as a document would. */
const apply = (source: string, edits: readonly TextEdit[]) =>
  [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
      source
    )

const hideCall = (
  source: string,
  call: string,
  argument: Operation extends never ? never : unknown = undefined
) => {
  const from = source.indexOf(call)
  return {
    type: 'StdLibCall',
    name: 'hide',
    sourceRange: [from, from + call.length, 0],
    unlabeledArg: argument ? { value: argument } : null,
    labeledArgs: {},
    nodePath: {},
  } as unknown as Extract<Operation, { type: 'StdLibCall' }>
}

const sketch = (id: string) => ({ type: 'Sketch', value: { artifactId: id } })

describe('addHide', () => {
  it('appends the call after everything that could have produced the value', () => {
    // `hide` takes a value, so the call has to come after whatever made it, and
    // the end of the file is the only position that is always true of.
    const source = 'a = 1\nb = 2\n'
    expect(apply(source, addHide(source, 'b'))).toBe('a = 1\nb = 2\nhide(b)\n')
  })

  it('starts a new line when the file does not end in one', () => {
    const source = 'a = 1'
    expect(apply(source, addHide(source, 'a'))).toBe('a = 1\nhide(a)\n')
  })

  it('appends to an empty program without inventing a blank line', () => {
    expect(apply('', addHide('', 'a'))).toBe('hide(a)\n')
  })
})

describe('removeHide', () => {
  it('removes a call that hides only that object, and its line', () => {
    const source = 'a = 1\nhide(a)\nb = 2\n'
    const edits = removeHide(
      source,
      hideCall(source, 'hide(a)', sketch('x')),
      'a'
    )

    // Leaving the blank line behind would have a file slowly fill with the gaps
    // where display instructions used to be.
    expect(apply(source, edits)).toBe('a = 1\nb = 2\n')
  })

  it('removes only the term when the call hides several', () => {
    const source = 'hide([a, b, c])\n'
    const argument = {
      type: 'Array',
      value: [sketch('x'), sketch('y'), sketch('z')],
    }
    const edits = removeHide(
      source,
      hideCall(source, 'hide([a, b, c])', argument),
      'b'
    )

    // Removing the whole call would un-hide `a` and `c` too, which looks like
    // the app forgetting.
    expect(apply(source, edits)).toBe('hide([a, c])\n')
  })

  it('removes the first term of a list without leaving a comma', () => {
    const source = 'hide([a, b])\n'
    const argument = { type: 'Array', value: [sketch('x'), sketch('y')] }
    const edits = removeHide(
      source,
      hideCall(source, 'hide([a, b])', argument),
      'a'
    )

    expect(apply(source, edits)).toBe('hide([b])\n')
  })

  it('removes the last term of a list without leaving a comma', () => {
    const source = 'hide([a, b])\n'
    const argument = { type: 'Array', value: [sketch('x'), sketch('y')] }
    const edits = removeHide(
      source,
      hideCall(source, 'hide([a, b])', argument),
      'b'
    )

    expect(apply(source, edits)).toBe('hide([a])\n')
  })

  it('treats a one-item list as a call to remove entirely', () => {
    const source = 'hide([a])\n'
    const argument = { type: 'Array', value: [sketch('x')] }
    const edits = removeHide(
      source,
      hideCall(source, 'hide([a])', argument),
      'a'
    )

    expect(apply(source, edits)).toBe('')
  })

  it('does nothing when the name is not in the call', () => {
    const source = 'hide([a, b])\n'
    const argument = { type: 'Array', value: [sketch('x'), sketch('y')] }
    expect(
      removeHide(source, hideCall(source, 'hide([a, b])', argument), 'zzz')
    ).toEqual([])
  })

  it('matches whole identifiers, not substrings of them', () => {
    const source = 'hide([ab, b])\n'
    const argument = { type: 'Array', value: [sketch('x'), sketch('y')] }
    const edits = removeHide(
      source,
      hideCall(source, 'hide([ab, b])', argument),
      'b'
    )

    // `b` must not match inside `ab`.
    expect(apply(source, edits)).toBe('hide([ab])\n')
  })
})
