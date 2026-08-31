import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_KCL_VERSION,
  type KclMetaWriter,
  LENGTH_UNITS,
  LENGTH_UNIT_LABELS,
  newKclFile,
  withKclVersion,
  withLengthUnit,
} from '@src/lib/kcl/metaSettings'

/**
 * kcl-lib, as far as this policy can tell.
 *
 * Records what it was asked for and returns something recognisable, because what
 * is being tested is *which calls are made with what* — the annotation itself is
 * kcl-lib's to write, and reimplementing its recast here would test this file
 * against a second guess at KCL.
 */
const writer = () => {
  const calls: string[] = []

  return {
    calls,
    change_default_units: vi.fn((code: string, lengthJson: string) => {
      calls.push(`units(${lengthJson})`)
      return `@settings(defaultLengthUnit = ${JSON.parse(lengthJson)})\n${code}`
    }),
    change_kcl_version: vi.fn((code: string, versionJson: string) => {
      calls.push(`version(${versionJson})`)
      return `@settings(kclVersion = ${JSON.parse(versionJson)})\n${code}`
    }),
  } satisfies KclMetaWriter & { calls: string[] }
}

describe('what a new KCL file says', () => {
  /*
   * App-controlled, and always: the version is what the language reads the file
   * as, so a file without one is a file whose meaning depends on which release
   * opened it.
   */
  it('declares the KCL version', () => {
    const api = writer()

    newKclFile(api)

    expect(api.change_kcl_version).toHaveBeenCalledWith(
      '',
      JSON.stringify(DEFAULT_KCL_VERSION)
    )
  })

  /*
   * An annotation that repeats kcl-lib's own default is noise in every file, and
   * the two cannot disagree.
   */
  it('says nothing about units when they are millimetres', () => {
    const api = writer()

    newKclFile(api, { lengthUnit: 'mm' })

    expect(api.change_default_units).not.toHaveBeenCalled()
  })

  /*
   * The important case. Without this a file in an inch project means inches only
   * for as long as the app happens to be configured that way, and silently means
   * millimetres for anybody else who opens it.
   */
  it('writes the unit down when it is not millimetres', () => {
    const api = writer()

    const contents = newKclFile(api, { lengthUnit: 'in' })

    expect(api.change_default_units).toHaveBeenCalledWith('', '"in"')
    expect(contents).toContain('defaultLengthUnit = in')
    expect(contents).toContain('kclVersion = 2.0')
  })

  it('sets the unit before the version, so both land in one annotation', () => {
    const api = writer()

    newKclFile(api, { lengthUnit: 'ft' })

    expect(api.calls).toEqual(['units("ft")', 'version("2.0")'])
  })

  /*
   * A file being copied in, or a sample being written out, brings its own
   * annotation and is not this policy's business.
   */
  it('leaves content that already exists alone', () => {
    const api = writer()

    const contents = newKclFile(api, {
      contents: 'x = 1',
      lengthUnit: 'in',
    })

    expect(contents).toBe('x = 1')
    expect(api.calls).toEqual([])
  })

  it('treats whitespace-only content as empty', () => {
    const api = writer()

    newKclFile(api, { contents: '  \n ', lengthUnit: 'mm' })

    expect(api.change_kcl_version).toHaveBeenCalled()
  })
})

describe('editing an annotation', () => {
  it('passes the unit through as JSON, which is how an option is spelled', () => {
    const api = writer()

    withLengthUnit(api, 'x = 1', 'cm')

    expect(api.change_default_units).toHaveBeenCalledWith('x = 1', '"cm"')
  })

  /*
   * Removing is a real thing to want: a file with no declaration follows the
   * project, which is the right state for a file that should track its
   * surroundings.
   */
  it('removes the declaration when given nothing', () => {
    const api = writer()

    withLengthUnit(api, 'x = 1', null)

    expect(api.change_default_units).toHaveBeenCalledWith('x = 1', 'null')
  })

  it('does the same for the version', () => {
    const api = writer()

    withKclVersion(api, 'x = 1', null)

    expect(api.change_kcl_version).toHaveBeenCalledWith('x = 1', 'null')
  })
})

describe('the unit table', () => {
  it('names every unit it offers', () => {
    for (const unit of LENGTH_UNITS) {
      expect(LENGTH_UNIT_LABELS[unit]).toBeTruthy()
    }
  })

  it('offers millimetres first, since it is the default', () => {
    expect(LENGTH_UNITS[0]).toBe('mm')
  })
})
