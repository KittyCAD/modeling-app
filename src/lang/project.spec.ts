import { newKclFile } from '@src/lang/project'
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
  return `@settings(kclVersion = ${version})\n\n${kcl}`
})

const wasmInstance = {
  change_default_units: changeDefaultUnits,
  change_kcl_version: changeKclVersion,
} as unknown as ModuleType

describe('newKclFile', () => {
  beforeEach(() => {
    changeDefaultUnits.mockClear()
    changeKclVersion.mockClear()
  })

  it('creates fresh files with the current KCL version setting', () => {
    expect(newKclFile(undefined, 'mm', wasmInstance)).toBe(
      `@settings(kclVersion = ${DEFAULT_KCL_VERSION})\n\n`
    )
    expect(newKclFile('', 'mm', wasmInstance)).toBe(
      `@settings(kclVersion = ${DEFAULT_KCL_VERSION})\n\n`
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
