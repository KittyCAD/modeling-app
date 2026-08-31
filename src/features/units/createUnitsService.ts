import { type ReadonlySignal, computed } from '@preact/signals'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { UnitsService } from '@src/contracts/units'
import type { KclWasmModule } from '@src/features/kclAnalysis/wasmModule'
import {
  DEFAULT_LENGTH_UNIT,
  type KclMetaWriter,
  newKclFile,
  withLengthUnit,
} from '@src/lib/kcl/metaSettings'

export interface UnitsDependencies {
  /** The resolved setting: project override, else user, else millimetres. */
  unit: ReadonlySignal<UnitLength>
  /**
   * kcl-lib, on demand.
   *
   * A function rather than a module, because it is several megabytes and nothing
   * here is worth loading it at boot: the annotation is written when a file is
   * created, which is a deliberate act with a moment to spare.
   */
  wasm: () => Promise<KclWasmModule>
}

/**
 * The unit the app works in, and the annotation that records it.
 *
 * Thin on purpose. The policy — which values a new file gets, and when a unit is
 * worth writing down — is in `lib/kcl/metaSettings.ts` where it can be read and
 * tested without a WASM module; this resolves the setting, loads kcl-lib, and
 * turns a thrown string into an `Error`.
 */
export function createUnitsService(
  dependencies: UnitsDependencies
): UnitsService {
  const writer = async (): Promise<KclMetaWriter> => {
    const module = await dependencies.wasm()
    return {
      change_default_units: (code, lengthJson) =>
        module.change_default_units(code, lengthJson),
      change_kcl_version: (code, versionJson) =>
        module.change_kcl_version(code, versionJson),
    }
  }

  return {
    defaultLengthUnit: computed(
      () => dependencies.unit.value ?? DEFAULT_LENGTH_UNIT
    ),

    async newFileContents(contents) {
      if (contents !== undefined && contents.trim() !== '') return contents

      try {
        return newKclFile(await writer(), {
          lengthUnit: dependencies.unit.peek(),
        })
      } catch (caught) {
        /*
         * A file with no annotation is a working file.
         *
         * So a KCL module that will not load costs the annotation rather than the
         * file. The alternative — refusing to create a file because a formatter is
         * unavailable — would be a worse answer to a worse problem.
         */
        console.warn('units: could not write the settings annotation', caught)
        return ''
      }
    },

    async withLengthUnit(source, unit) {
      return withLengthUnit(await writer(), source, unit)
    },
  }
}
