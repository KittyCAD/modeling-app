import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import {
  isKclVersionAvailable,
  kclVersionAtLeast,
} from '@src/lib/kclVersionRange'
import fc from 'fast-check'
import { expect, it } from 'vitest'

it.each<[KclVersion, boolean, boolean]>([
  ['1.0', false, true],
  ['2.0', false, true],
  ['3.0-preview', true, false],
  ['3.0', true, false],
])(
  'applies inclusive addedIn and exclusive removedIn to %s',
  (version, added, removed) => {
    expect(isKclVersionAvailable(version, { addedIn: '3.0' })).toBe(added)
    expect(isKclVersionAvailable(version, { removedIn: '3.0' })).toBe(removed)
    expect(isKclVersionAvailable(version, {})).toBe(true)
  }
)

it('does not treat unknown or invalid source as a usable version', () => {
  expect(isKclVersionAvailable(null, {})).toBe(false)
})

it('compares numeric version boundaries, including multi-digit components', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      (major, minor) => {
        expect(kclVersionAtLeast('3.0-preview', `${major}.${minor}`)).toBe(
          major < 3 || (major === 3 && minor === 0)
        )
      }
    )
  )
  // Like Rust's component-vector comparison, a longer equal prefix sorts later.
  expect(kclVersionAtLeast('2.0', '2')).toBe(true)
  expect(kclVersionAtLeast('2.0', '2.0.0')).toBe(false)
})
