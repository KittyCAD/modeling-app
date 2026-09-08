import {
  ensureDefaultKclVersionOnBlankMain,
  isMainKclPath,
  newKclFile,
} from '@src/lang/project'
import { DEFAULT_KCL_VERSION } from '@src/lib/constants'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const changeDefaultUnits = vi.fn((kcl: string, len: string) => {
  const defaultLengthUnit = JSON.parse(len)
  return `@settings(defaultLengthUnit = ${defaultLengthUnit})\n\n${kcl}`
})

const changeKclVersion = vi.fn((kcl: string, versionString: string) => {
  const version = JSON.parse(versionString)
  if (kcl.startsWith('@settings(')) {
    return kcl.replace(')', `, kclVersion = ${version})`)
  }
  return `@settings(kclVersion = ${version})\n${kcl}`
})

const isKclEmptyOrOnlySettings = vi.fn((kcl: string) => {
  return kcl.replace(/@settings\([^)]*\)/g, '').trim() === ''
})

const wasmInstance = {
  change_default_units: changeDefaultUnits,
  change_kcl_version: changeKclVersion,
  is_kcl_empty_or_only_settings: isKclEmptyOrOnlySettings,
} as unknown as ModuleType

describe('newKclFile', () => {
  beforeEach(() => {
    changeDefaultUnits.mockClear()
    changeKclVersion.mockClear()
    isKclEmptyOrOnlySettings.mockClear()
  })

  it('creates fresh files with the current KCL version setting', () => {
    expect(newKclFile(undefined, 'mm', wasmInstance)).toBe(
      `@settings(kclVersion = ${DEFAULT_KCL_VERSION})\n`
    )
    expect(newKclFile('', 'mm', wasmInstance)).toBe(
      `@settings(kclVersion = ${DEFAULT_KCL_VERSION})\n`
    )
    expect(newKclFile('  \n', 'mm', wasmInstance)).toBe(
      `@settings(kclVersion = ${DEFAULT_KCL_VERSION})\n`
    )
    expect(changeDefaultUnits).not.toHaveBeenCalled()
    expect(changeKclVersion).toHaveBeenCalledWith(
      '',
      JSON.stringify(DEFAULT_KCL_VERSION)
    )
  })

  it('preserves non-empty initial content', () => {
    const existingCode = '@settings(kclVersion = 1.0)\n\nx = 1'

    expect(newKclFile(existingCode, 'mm', wasmInstance)).toBe(existingCode)
    expect(changeDefaultUnits).not.toHaveBeenCalled()
    expect(changeKclVersion).not.toHaveBeenCalled()
  })

  it('keeps the user default length unit for fresh files', () => {
    expect(newKclFile(undefined, 'in', wasmInstance)).toBe(
      `@settings(defaultLengthUnit = in, kclVersion = ${DEFAULT_KCL_VERSION})\n\n`
    )
    expect(changeDefaultUnits).toHaveBeenCalledWith('', JSON.stringify('in'))
    expect(changeKclVersion).toHaveBeenCalledWith(
      '@settings(defaultLengthUnit = in)\n\n',
      JSON.stringify(DEFAULT_KCL_VERSION)
    )
  })
})

describe('ensureDefaultKclVersionOnBlankMain', () => {
  beforeEach(() => {
    changeKclVersion.mockClear()
    isKclEmptyOrOnlySettings.mockClear()
  })

  it('matches main.kcl paths', () => {
    expect(isMainKclPath('main.kcl')).toBe(true)
    expect(isMainKclPath('/projects/bracket/main.kcl')).toBe(true)
    expect(isMainKclPath('C:\\projects\\bracket\\main.kcl')).toBe(true)
    expect(isMainKclPath('/projects/bracket/other.kcl')).toBe(false)
  })

  it('sets kclVersion on empty main.kcl', () => {
    expect(
      ensureDefaultKclVersionOnBlankMain(
        '/projects/bracket/main.kcl',
        '',
        wasmInstance
      )
    ).toBe(`@settings(kclVersion = ${DEFAULT_KCL_VERSION})\n`)
    expect(changeKclVersion).toHaveBeenCalledWith(
      '',
      JSON.stringify(DEFAULT_KCL_VERSION)
    )
  })

  it('adds kclVersion to settings-only main.kcl without replacing other settings', () => {
    const existingSettings = '@settings(defaultLengthUnit = in)\n\n'
    expect(
      ensureDefaultKclVersionOnBlankMain(
        '/projects/bracket/main.kcl',
        existingSettings,
        wasmInstance
      )
    ).toBe(
      `@settings(defaultLengthUnit = in, kclVersion = ${DEFAULT_KCL_VERSION})\n\n`
    )
    expect(isKclEmptyOrOnlySettings).toHaveBeenCalledWith(existingSettings)
    expect(changeKclVersion).toHaveBeenCalledWith(
      existingSettings,
      JSON.stringify(DEFAULT_KCL_VERSION)
    )
  })

  it('does not modify main.kcl that already has program code', () => {
    const existingCode = '@settings(kclVersion = 1.0)\n\nx = 1'
    expect(
      ensureDefaultKclVersionOnBlankMain(
        '/projects/bracket/main.kcl',
        existingCode,
        wasmInstance
      )
    ).toBe(existingCode)
    expect(changeKclVersion).not.toHaveBeenCalled()
  })

  it('does not modify empty files that are not main.kcl', () => {
    expect(
      ensureDefaultKclVersionOnBlankMain(
        '/projects/bracket/other.kcl',
        '',
        wasmInstance
      )
    ).toBe('')
    expect(changeKclVersion).not.toHaveBeenCalled()
  })
})
