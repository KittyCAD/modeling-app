import { join } from 'node:path'
import { assertParse } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import {
  getFeatureHistory,
  reorderHistoryBlock,
  ROLLBACK_CODE,
  setHistoryRollback,
} from '@src/lib/featureTree/featureHistory'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, it } from 'vitest'

let instance: ModuleType
beforeAll(async () => {
  instance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm')
  )
})

function history(code: string) {
  return getFeatureHistory(assertParse(code, instance), code)
}

const settings = '@settings(kclVersion = 3.0)\n\n'

describe('feature history source edits', () => {
  it('rolls back before the first, middle and last block, then restores the exact source', () => {
    const code = settings + 'a = 1\nb = 2\nc = 3\n'
    for (const index of [0, 1, 2]) {
      const changed = setHistoryRollback(history(code), index)
      const parsed = history(changed)
      expect(parsed.rollbackIndex).toBe(index)
      expect(parsed.blocks).toHaveLength(3)
      expect(setHistoryRollback(parsed, 3)).toBe(code)
      expect(
        setHistoryRollback(parsed, index).match(/zds:rollback/g)
      ).toHaveLength(1)
    }
  })

  it('preserves ordinary exit calls and marker-like strings', () => {
    const code = settings + 'a = "exit() // zds:rollback"\nexit()\nb = 2\n'
    expect(history(code).blocks).toHaveLength(3)
    expect(setHistoryRollback(history(code), 3)).toBe(code)
  })

  it('preserves CRLF, unicode, annotations and comments', () => {
    const code = (
      settings + '// First block\na = "🙂 café"\n// Second block\nb = 2\n'
    ).replaceAll('\n', '\r\n')
    const changed = setHistoryRollback(history(code), 1)
    expect(changed).toContain(ROLLBACK_CODE.replaceAll('\n', '\r\n'))
    expect(setHistoryRollback(history(changed), 2)).toBe(code)
  })

  it('moves an independent block up and down without losing an unterminated last line', () => {
    const code = settings + 'a = 1\nb = 2\nc = 3'
    const down = reorderHistoryBlock(history(code), 0, 3)
    expect(down).toBe(settings + 'b = 2\nc = 3\na = 1\n')
    const up = reorderHistoryBlock(history(code), 2, 0)
    expect(up).toBe(settings + 'c = 3\na = 1\nb = 2\n')
    if (typeof up === 'string') expect(history(up).blocks).toHaveLength(3)
  })

  it('keeps a pipeline and sketch block intact', () => {
    const sketch =
      'profile = sketch(on = XY) {\n  l = line(start = [0mm, 0mm], end = [1mm, 0mm])\n}\n'
    const pipeline = 'solid = 1\n  |> abs(%)\n'
    const code = settings + sketch + pipeline
    const result = reorderHistoryBlock(history(code), 1, 0)
    expect(result).toBe(settings + pipeline + sketch)
    if (typeof result === 'string')
      expect(history(result).blocks).toHaveLength(3)
  })

  it('blocks moves of either a dependency or its consumer', () => {
    const code = settings + 'a = 1\nb = a + 1\nc = 3\n'
    expect(reorderHistoryBlock(history(code), 1, 0)).toBeInstanceOf(Error)
    expect(reorderHistoryBlock(history(code), 0, 3)).toBeInstanceOf(Error)
    expect(reorderHistoryBlock(history(code), 2, 0)).toBe(
      settings + 'c = 3\na = 1\nb = a + 1\n'
    )
  })

  it('blocks crossed function captures and tag references', () => {
    const code = settings + 'a = 1\nfn f() { return a }\nb = 2\n'
    expect(reorderHistoryBlock(history(code), 1, 0)).toBeInstanceOf(Error)
  })

  it('keeps the rollback boundary when reordering suppressed blocks', () => {
    const code = settings + 'a = 1\n' + ROLLBACK_CODE + 'b = 2\nc = 3\n'
    const result = reorderHistoryBlock(history(code), 2, 1)
    expect(typeof result).toBe('string')
    if (typeof result === 'string') {
      expect(history(result).rollbackIndex).toBe(1)
      expect(history(result).blocks.map((block) => block.label)).toEqual([
        'a',
        'c',
        'b',
      ])
    }
  })

  it('keeps imports pinned and rejects invalid destinations', () => {
    const code = settings + 'a = 1\nimport "part.kcl"\nb = 2\n'
    expect(reorderHistoryBlock(history(code), 1, 0)).toBeInstanceOf(Error)
    expect(reorderHistoryBlock(history(code), 2, 0)).toBeInstanceOf(Error)
    expect(reorderHistoryBlock(history(code), 0, -1)).toBeInstanceOf(Error)
  })

  it('reorders individual stages inside their own pipeline', () => {
    const code = settings + 'a = 1\n  |> abs(%)\n  |> round(%)\nb = 2\n'
    const result = reorderHistoryBlock(history(code), 2, 1)
    expect(result).toBe(settings + 'a = 1\n  |> round(%)\n  |> abs(%)\nb = 2\n')
    expect(reorderHistoryBlock(history(code), 1, 0)).toBeInstanceOf(Error)
    expect(reorderHistoryBlock(history(code), 1, 4)).toBeInstanceOf(Error)
    expect(reorderHistoryBlock(history(code), 3, 1)).toBeInstanceOf(Error)
  })

  it('rolls back within a pipeline and restores its exact source', () => {
    const code = settings + 'a = 1\n  |> abs(%)\n  |> round(%)\nb = 2\n'
    for (const index of [1, 2]) {
      const changed = setHistoryRollback(history(code), index)
      expect(changed).toContain('  |> ' + ROLLBACK_CODE)
      expect(history(changed).rollbackIndex).toBe(index)
      expect(setHistoryRollback(history(changed), 4)).toBe(code)
    }
  })

  it('moves an entire pipeline by its input and blocks type-changing stage moves', () => {
    const code = settings + 'a = 1\n  |> abs(%)\n  |> round(%)\nb = 2\n'
    expect(reorderHistoryBlock(history(code), 0, 4)).toBe(
      settings + 'b = 2\na = 1\n  |> abs(%)\n  |> round(%)\n'
    )
    const geometry =
      settings +
      'a = 1\n  |> extrude(length = 2)\n  |> fillet(radius = 1, tags = [])\n'
    expect(reorderHistoryBlock(history(geometry), 2, 1)).toBeInstanceOf(Error)
  })

  it('blocks tag dependencies between otherwise compatible pipeline stages', () => {
    const code =
      settings +
      'a = 1\n  |> line(end = [1, 0], tag = $edge1)\n  |> line(end = [segLen(edge1), 0])\n'
    expect(reorderHistoryBlock(history(code), 2, 1)).toBeInstanceOf(Error)
  })

  it('does not treat a shadowed standard library function as a compatible stage', () => {
    const code =
      settings +
      'fn round(@x) { return x }\na = 1\n  |> abs(%)\n  |> round(%)\n'
    expect(reorderHistoryBlock(history(code), 3, 2)).toBeInstanceOf(Error)
    expect(reorderHistoryBlock(history(code), 2, 4)).toBeInstanceOf(Error)
  })

  it('restores an inline pipeline and preserves comments added after rollback', () => {
    const code = settings + 'a = 1 |> abs(%) |> round(%)\n'
    const changed = setHistoryRollback(history(code), 1)
    expect(setHistoryRollback(history(changed), 3)).toBe(code)
    const commented =
      settings + 'a = 1\n' + ROLLBACK_CODE + '// Keep this comment\nb = 2\n'
    expect(setHistoryRollback(history(commented), 2)).toBe(
      settings + 'a = 1\n// Keep this comment\nb = 2\n'
    )
  })

  it('moves a pipeline stage with its standalone comments and leaves inline comments with their stage', () => {
    const code =
      settings +
      'a = 1\n  |> abs(%) // absolute value\n  // Round the result\n  |> round(%)\n'
    expect(reorderHistoryBlock(history(code), 2, 1)).toBe(
      settings +
        'a = 1\n  // Round the result\n  |> round(%)\n  |> abs(%) // absolute value\n'
    )
    const changed = setHistoryRollback(history(code), 2)
    expect(setHistoryRollback(history(changed), 3)).toBe(code)
  })

  it('actually stops pipeline and subsequent statement execution at the bar', async () => {
    const code =
      '@settings(kclVersion = 3.0, experimentalFeatures = allow)\n' +
      'a = 1\n  |> abs(%)\n  |> assert(isEqualTo = 2)\nassert(1, isEqualTo = 2)\n'
    const rolledBack = setHistoryRollback(history(code), 2)
    const context = new instance.Context({}, {})
    try {
      const result = await context.executeMock(
        JSON.stringify(assertParse(rolledBack, instance)),
        undefined,
        JSON.stringify(instance.default_app_settings()),
        false
      )
      expect(result.issues).toEqual([])
    } finally {
      context.free()
    }
  })
})
