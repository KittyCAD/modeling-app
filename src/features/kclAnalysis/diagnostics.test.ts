import { describe, expect, it } from 'vitest'
import {
  issuesToDiagnostics,
  thrownErrorToDiagnostics,
} from '@src/features/kclAnalysis/diagnostics'

describe('issuesToDiagnostics', () => {
  it('maps severity onto the editor vocabulary', () => {
    const diagnostics = issuesToDiagnostics(
      [
        { sourceRange: [0, 5, 0], message: 'bad', severity: 'Error' },
        { sourceRange: [6, 9, 0], message: 'meh', severity: 'Warning' },
        { sourceRange: [10, 12, 0], message: 'dead', severity: 'Fatal' },
      ],
      20
    )

    expect(diagnostics.map((d) => d.severity)).toEqual([
      'error',
      'warning',
      // Fatal is still an error to the editor: there is no louder gutter marker.
      'error',
    ])
  })

  it('clamps a range that points past the end of the document', () => {
    // The parser may have seen content a version ahead of the consumer, and
    // CodeMirror throws on an out-of-range diagnostic rather than ignoring it.
    const [diagnostic] = issuesToDiagnostics(
      [{ sourceRange: [50, 90, 0], message: 'far', severity: 'Error' }],
      10
    )

    expect(diagnostic.from).toBe(10)
    expect(diagnostic.to).toBe(10)
  })

  it('widens a zero-width range so the marker is visible', () => {
    const [diagnostic] = issuesToDiagnostics(
      [{ sourceRange: [3, 3, 0], message: 'here', severity: 'Error' }],
      10
    )

    // An error you cannot see is an error you cannot fix.
    expect(diagnostic).toMatchObject({ from: 3, to: 4 })
  })

  it('does not widen past the end of an empty document', () => {
    const [diagnostic] = issuesToDiagnostics(
      [{ sourceRange: [0, 0, 0], message: 'empty', severity: 'Error' }],
      0
    )
    expect(diagnostic).toMatchObject({ from: 0, to: 0 })
  })

  it('keeps a range whose end precedes its start from inverting', () => {
    const [diagnostic] = issuesToDiagnostics(
      [{ sourceRange: [8, 2, 0], message: 'odd', severity: 'Error' }],
      20
    )
    expect(diagnostic.to).toBeGreaterThanOrEqual(diagnostic.from)
  })

  it('returns nothing for no issues', () => {
    expect(issuesToDiagnostics([], 10)).toEqual([])
  })
})

describe('thrownErrorToDiagnostics', () => {
  it('reads the nested KCL error shape', () => {
    const [diagnostic] = thrownErrorToDiagnostics(
      JSON.stringify({
        kind: 'syntax',
        details: { msg: 'Unexpected token', sourceRanges: [[4, 9, 0]] },
      }),
      20
    )

    expect(diagnostic).toMatchObject({
      from: 4,
      to: 9,
      severity: 'error',
      message: 'Unexpected token',
    })
  })

  it('reads the flat shape too, since it has varied between versions', () => {
    const [diagnostic] = thrownErrorToDiagnostics(
      JSON.stringify({ msg: 'Broken', sourceRanges: [[1, 2, 0]] }),
      20
    )
    expect(diagnostic).toMatchObject({ from: 1, to: 2, message: 'Broken' })
  })

  it('still produces a diagnostic for an unrecognisable failure', () => {
    // Swallowing it would leave the user with a viewport that says nothing is
    // wrong and an editor that will not run.
    const [diagnostic] = thrownErrorToDiagnostics('total nonsense', 20)

    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.message).toContain('total nonsense')
    expect(diagnostic.from).toBe(0)
  })

  it('handles an Error instance', () => {
    const [diagnostic] = thrownErrorToDiagnostics(new Error('boom'), 20)
    expect(diagnostic.message).toContain('boom')
  })

  it('handles a failure with no source range', () => {
    const [diagnostic] = thrownErrorToDiagnostics(
      JSON.stringify({ details: { msg: 'No position' } }),
      20
    )
    expect(diagnostic).toMatchObject({ from: 0, to: 1, message: 'No position' })
  })
})
