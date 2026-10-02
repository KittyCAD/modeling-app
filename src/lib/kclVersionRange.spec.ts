import { join } from 'node:path'
import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { isKclVersionAvailable } from '@src/lib/kclVersionRange'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import fc from 'fast-check'
import { beforeAll, expect, it } from 'vitest'

let instance: ModuleType
beforeAll(async () => {
  instance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})

it.each<[KclVersion, boolean, boolean]>([
  ['1.0', false, true],
  ['2.0', false, true],
  ['3.0-preview', true, false],
  ['3.0', true, false],
])(
  'applies inclusive addedIn and exclusive removedIn to %s',
  (version, added, removed) => {
    expect(isKclVersionAvailable(version, { addedIn: '3.0' }, instance)).toBe(
      added
    )
    expect(isKclVersionAvailable(version, { removedIn: '3.0' }, instance)).toBe(
      removed
    )
    expect(isKclVersionAvailable(version, {}, instance)).toBe(true)
    expect(
      isKclVersionAvailable(
        version,
        { addedIn: '2.0', removedIn: '3.0' },
        instance
      )
    ).toBe(version === '2.0')
  }
)

it('does not treat unknown or invalid source as a usable version', () => {
  expect(isKclVersionAvailable(null, {}, instance)).toBe(false)
})

it('compares numeric version boundaries, including multi-digit components', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      (major, minor) => {
        expect(
          isKclVersionAvailable(
            '3.0-preview',
            { addedIn: `${major}.${minor}` },
            instance
          )
        ).toBe(major < 3 || (major === 3 && minor === 0))
      }
    )
  )
  // Like Rust's component-vector comparison, a longer equal prefix sorts later.
  expect(isKclVersionAvailable('2.0', { addedIn: '2' }, instance)).toBe(true)
  expect(isKclVersionAvailable('2.0', { addedIn: '2.0.0' }, instance)).toBe(
    false
  )
})

it('rejects malformed boundaries instead of silently treating them as available', () => {
  for (const boundary of ['', '3.x', '-1.0', '3.0-preview']) {
    expect(() =>
      isKclVersionAvailable('3.0', { addedIn: boundary }, instance)
    ).toThrow()
    expect(() =>
      isKclVersionAvailable('3.0', { removedIn: boundary }, instance)
    ).toThrow()
  }
})
