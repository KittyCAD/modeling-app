import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { KclWasmModule } from '@src/features/kclAnalysis/wasmModule'
import { createUnitsService } from '@src/features/units/createUnitsService'

/** kcl-lib, as far as this service can tell. */
const fakeWasm = () => {
  const change_default_units = vi.fn(
    (code: string, lengthJson: string) =>
      `@settings(defaultLengthUnit = ${JSON.parse(lengthJson)})\n${code}`
  )
  const change_kcl_version = vi.fn(
    (code: string, versionJson: string) =>
      `@settings(kclVersion = ${JSON.parse(versionJson)})\n${code}`
  )

  return {
    module: {
      change_default_units,
      change_kcl_version,
    } as unknown as KclWasmModule,
    change_default_units,
    change_kcl_version,
  }
}

const setup = (unit: UnitLength = 'mm') => {
  const wasm = fakeWasm()
  const value = signal<UnitLength>(unit)

  return {
    wasm,
    value,
    units: createUnitsService({
      unit: value,
      wasm: async () => wasm.module,
    }),
  }
}

describe('the unit the app works in', () => {
  it('follows the setting', () => {
    const app = setup('in')

    expect(app.units.defaultLengthUnit.value).toBe('in')

    app.value.value = 'cm'
    expect(app.units.defaultLengthUnit.value).toBe('cm')
  })
})

describe('what a new file contains', () => {
  it('declares the version, and the unit when it is not millimetres', async () => {
    const app = setup('in')

    const contents = await app.units.newFileContents()

    expect(contents).toContain('defaultLengthUnit = in')
    expect(contents).toContain('kclVersion = 2.0')
  })

  it('declares only the version in a millimetre project', async () => {
    const app = setup('mm')

    const contents = await app.units.newFileContents()

    expect(contents).toContain('kclVersion = 2.0')
    expect(app.wasm.change_default_units).not.toHaveBeenCalled()
  })

  it('leaves content it was given alone', async () => {
    const app = setup('in')

    expect(await app.units.newFileContents('width = 2')).toBe('width = 2')
    expect(app.wasm.change_kcl_version).not.toHaveBeenCalled()
  })

  /*
   * A file with no annotation is a working file, so a KCL module that will not
   * load costs the annotation rather than the file. Refusing to create a file
   * because a formatter is unavailable would be a worse answer.
   */
  it('creates an empty file when kcl-lib cannot be loaded', async () => {
    const units = createUnitsService({
      unit: signal<UnitLength>('in'),
      wasm: async () => {
        throw new Error('no wasm today')
      },
    })

    expect(await units.newFileContents()).toBe('')
  })
})

describe('changing a file’s unit', () => {
  it('hands the file to kcl-lib rather than editing text here', async () => {
    const app = setup()

    const result = await app.units.withLengthUnit('width = 2', 'yd')

    expect(app.wasm.change_default_units).toHaveBeenCalledWith(
      'width = 2',
      '"yd"'
    )
    expect(result).toContain('defaultLengthUnit = yd')
  })

  /*
   * Removing the declaration means "follow the project", which is a real state
   * for a file to be in.
   */
  it('can take the declaration away', async () => {
    const app = setup()

    await app.units.withLengthUnit('width = 2', null)

    expect(app.wasm.change_default_units).toHaveBeenCalledWith(
      'width = 2',
      'null'
    )
  })

  /*
   * Unlike creating a file, this is a request about a *specific* file and there
   * is no sensible fallback: silently doing nothing would look like the click
   * missed.
   */
  it('fails loudly when kcl-lib cannot be loaded', async () => {
    const units = createUnitsService({
      unit: signal<UnitLength>('mm'),
      wasm: async () => {
        throw new Error('no wasm today')
      },
    })

    await expect(units.withLengthUnit('width = 2', 'in')).rejects.toThrow(
      'no wasm today'
    )
  })
})
