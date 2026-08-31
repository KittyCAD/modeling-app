import { type IconName, Menu } from '@kittycad/ui-kit'
import { useComputed } from '@preact/signals'
import { useService } from '@src/app/context'
import { kclSceneService } from '@src/contracts/kclScene'
import { projectSessionService } from '@src/contracts/projectSession'
import { unitsService } from '@src/contracts/units'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { textDiff } from '@src/lib/buffers/textDiff'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { defaultLengthUnitOf } from '@src/lib/kclStdlib/program'
import {
  LENGTH_UNITS,
  LENGTH_UNIT_LABELS,
  DEFAULT_LENGTH_UNIT,
} from '@src/lib/kcl/metaSettings'

/**
 * What the executing file is working in, and a way to change it.
 *
 * Two units are in play and the distinction is the whole point of showing it:
 * what the *file* declares, and what the app would use if it declared nothing.
 * The field shows the effective one — that is the number a `10` in the file
 * means — and the menu marks it, so choosing the one already in force is a
 * no-op rather than a puzzle.
 *
 * Changing it rewrites the file's `@settings` annotation and lets the ordinary
 * execution path notice, because that is exactly what it is: an edit to the file
 * that changes what the geometry means. Recording it as a `semantic` edit keeps
 * it one undo step and keeps it out of the "typed by a person" bucket.
 */
export function UnitsField() {
  const sessions = useService(projectSessionService)
  const scene = useService(kclSceneService)
  const units = useService(unitsService)

  const executing = useComputed(
    () => sessions.current.value?.executingBuffer.value ?? null
  )

  /**
   * What the file declares, or null.
   *
   * Read off the last run's program rather than by parsing here: the annotation
   * is part of the file's meaning, so the AST that produced the geometry on
   * screen is the honest source for what that geometry is measured in.
   */
  const declared = useComputed(() => {
    const ast = scene.program.value?.ast as Program | undefined
    return ast ? defaultLengthUnitOf(ast) : null
  })

  const fallback = useComputed(() => units.defaultLengthUnit.value)

  /** The unit a number in the file actually means. */
  const effective = useComputed<UnitLength>(
    () =>
      (declared.value as UnitLength | null) ??
      fallback.value ??
      DEFAULT_LENGTH_UNIT
  )

  const choose = async (unit: UnitLength) => {
    const buffer = executing.peek()
    if (!buffer) return

    const before = buffer.text.peek()
    const after = await units.withLengthUnit(before, unit)
    const changes = textDiff(before, after)
    if (changes.length === 0) return

    buffer.dispatch({
      changes: changes.map((change) => ({
        from: change.from,
        to: change.to,
        insert: change.insert,
      })),
      /*
       * No `requestExecution`: this *is* a text change, and the executor already
       * runs on those. Saying it twice would run the file twice.
       */
      annotations: [bufferOrigin.of('semantic')],
    })
  }

  const sections = [
    {
      id: 'units',
      label: 'Default length unit',
      items: LENGTH_UNITS.map((unit) => ({
        id: unit,
        label: LENGTH_UNIT_LABELS[unit],
        // Marked rather than disabled: choosing the current unit is harmless and
        // being told which one is current is the reason the list is open.
        icon: (unit === effective.value ? 'checkmark' : 'ruler') as IconName,
        onSelect: () => {
          void choose(unit).catch((error) => {
            // A file that cannot be parsed cannot be annotated. The editor is
            // already showing why.
            console.warn('units: could not set the file’s units', error)
          })
        },
      })),
    },
  ]

  const title = useComputed(() =>
    declared.value
      ? `This file declares ${LENGTH_UNIT_LABELS[effective.value]}`
      : `This file declares no unit, so ${LENGTH_UNIT_LABELS[effective.value]} applies`
  )

  return (
    <Menu
      label="Choose the default length unit for the executing file"
      align="end"
      // The status bar is the bottom of the window; there is nothing below it.
      side="above"
      sections={sections}
      trigger={({ open, toggle, ref }) => (
        <button
          type="button"
          ref={ref}
          class="zds-status-button"
          title={title.value}
          aria-expanded={open}
          disabled={executing.value === null}
          onClick={toggle}
        >
          <span>units</span>
          <span class="zds-status-field__value">{effective.value}</span>
        </button>
      )}
    />
  )
}
