import { describe, expect, it } from 'vitest'
import { kcleanDiagnosticsForSource } from '@src/features/bevyScene/kcleanDiagnostics'

describe('Kclean source diagnostics', () => {
  it('converts UTF-8 kernel bytes to CodeMirror UTF-16 positions', () => {
    const source = 'α = 1mm\nregion(point = [0mm, 0mm])'
    const start = new TextEncoder().encode('α = 1mm\n').byteLength
    const end = start + new TextEncoder().encode('region').byteLength

    expect(
      kcleanDiagnosticsForSource(source, [
        {
          source: 'main.kcl',
          start,
          end,
          severity: 'error',
          message: 'region failed',
        },
      ])
    ).toEqual([
      {
        from: 'α = 1mm\n'.length,
        to: 'α = 1mm\nregion'.length,
        severity: 'error',
        message: 'region failed',
      },
    ])
  })

  it('widens a zero-width range so the diagnostic remains visible', () => {
    expect(
      kcleanDiagnosticsForSource('abc', [
        {
          source: 'main.kcl',
          start: 1,
          end: 1,
          severity: 'error',
          message: 'halted',
        },
      ])[0]
    ).toMatchObject({ from: 1, to: 2, severity: 'error' })
  })
})
