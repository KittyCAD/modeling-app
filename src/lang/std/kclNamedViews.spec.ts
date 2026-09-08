import type { VisibilityKind } from '@src/lang/std/kclNamedViews'
import { VISIBILITY_KINDS } from '@src/lang/std/kclNamedViews'
import { STD_LIB_COMMANDS } from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import { describe, expect, it } from 'vitest'

/**
 * Integration rather than unit, because `STD_LIB_COMMANDS` loads
 * `@rust/kcl-lib/bindings`, which only the wasm build produces. The unit
 * project runs without it.
 */

const EXCEPT_TYPE_TO_KINDS: Record<string, readonly VisibilityKind[]> = {
  Solid: ['sweep', 'compositeSolid'],
  Sketch: ['path'],
  GdtAnnotation: ['gdtAnnotation'],
}

/** Splits the recorded type `[Solid | Sketch | GdtAnnotation; 1+]`. */
function kclTypesInArrayType(recordedType: string): string[] {
  const match = /^\[(.+);\s*1\+\]$/.exec(recordedType)
  expect(
    match,
    `unexpected recorded type for except: ${recordedType}`
  ).not.toBeNull()

  return (match?.[1] ?? '').split('|').map((name) => name.trim())
}

/**
 * Pins `except`'s accepted types and `VISIBILITY_KINDS` to the same objects.
 * Drift either way is a defect:
 *
 * - in the universe, unnameable: any `Hide` baseline hides it with no way to
 *   show it again;
 * - nameable, outside the universe: the `except` entry does nothing.
 *
 * The types come from the generated binding, so widening `except` in Rust
 * without widening `VISIBILITY_KINDS` fails here.
 */
describe('the universe and `view::named`', () => {
  it('cover exactly the same objects', () => {
    const exceptArg = STD_LIB_COMMANDS['view::named'].args.find(
      (arg) => arg.name === 'except'
    )
    expect(exceptArg, 'view::named has no `except` argument').toBeDefined()

    const kclTypes = kclTypesInArrayType(exceptArg?.ty ?? '')
    expect(kclTypes.length).toBeGreaterThan(0)

    for (const kclType of kclTypes) {
      expect(
        EXCEPT_TYPE_TO_KINDS[kclType],
        `no universe kind recorded for the type ${kclType} that except accepts`
      ).toBeDefined()
    }

    const kindsExceptCanName = new Set(
      kclTypes.flatMap((kclType) => [...(EXCEPT_TYPE_TO_KINDS[kclType] ?? [])])
    )

    expect([...kindsExceptCanName].sort()).toEqual([...VISIBILITY_KINDS].sort())
  })
})
