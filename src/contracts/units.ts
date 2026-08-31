import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'

/**
 * What unit this app is working in, and what a new file says about it.
 *
 * One service rather than a setting everybody reads, because the answer is used
 * for three different things and only one of them is a preference lookup:
 *
 *  - **execution** needs it, because a file with no `@settings` annotation means
 *    whatever the app says it means. Get this wrong and the geometry is the wrong
 *    size, silently.
 *  - **writing numbers** needs it: a sketch tool that writes `10mm` into a file
 *    whose author works in inches is arithmetically correct and reads as though
 *    the app has a different idea of the drawing than they do.
 *  - **new files** need it, and they need it *written down* — see
 *    `lib/kcl/metaSettings.ts` for why an inch project cannot rely on the app
 *    being configured for inches.
 */
export interface UnitsService {
  /**
   * The unit that applies where no file says otherwise.
   *
   * Project override, else the user's, else millimetres — the ordinary settings
   * cascade, resolved here so nothing else has to know there are two levels.
   */
  readonly defaultLengthUnit: ReadonlySignal<UnitLength>

  /**
   * What a brand-new KCL file should contain.
   *
   * Async because it is kcl-lib that writes the annotation, and kcl-lib is a
   * multi-megabyte WASM module loaded on demand. Falls back to empty content if
   * it cannot be loaded: a file with no annotation is a working file, and
   * refusing to create one because a formatter is unavailable would not be.
   */
  newFileContents(contents?: string): Promise<string>

  /**
   * The same file, declaring a different unit.
   *
   * Null removes the declaration, which means "follow the project". Rejects if
   * the file cannot be parsed — an annotation cannot be edited into a file that
   * is not KCL yet.
   */
  withLengthUnit(source: string, unit: UnitLength | null): Promise<string>
}

export const unitsContract = defineContract({
  unitsService: defineService<UnitsService>('kcl.units'),
})

export const { unitsService } = unitsContract
