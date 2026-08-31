import { Icon } from '@kittycad/ui-kit'
import { useComputed } from '@preact/signals'
import { useService } from '@src/app/context'
import type {
  DefaultPlaneView,
  PlaneVisibility,
} from '@src/contracts/defaultPlanes'
import { defaultPlanesService } from '@src/contracts/defaultPlanes'
import './planesSection.css'

/**
 * The six default planes, above the feature tree.
 *
 * Above because they are what the scene is *before* it has features, and because
 * on an empty project they are the only rows the outline has — a section that
 * only appears below an empty list would read as an afterthought.
 *
 * Every row says the same three things: which plane, whether it is showing, and
 * whether that is the automatic answer or one somebody gave. The third is what
 * makes the panel explicable rather than mysterious, and it is the thing the
 * existing app cannot say at all, because there visibility is a flag with no
 * record of who set it.
 */
export function PlanesSection() {
  const planes = useService(defaultPlanesService)

  const rows = useComputed(() => planes.planes.value)
  const available = useComputed(() => planes.available.value)
  const empty = useComputed(() => planes.sceneIsEmpty.value)
  const overridden = useComputed(() => planes.overridden.value)

  if (!available.value) {
    return (
      <p class="zds-planes__note">
        The planes are created by a run. Execute a file to see them.
      </p>
    )
  }

  return (
    <div class="zds-planes">
      <ul class="zds-planes__list">
        {rows.value.map((plane) => (
          <PlaneRow key={plane.name} plane={plane} />
        ))}
      </ul>

      <p class="zds-planes__note">
        {/*
          Says *why*, because a plane that appears and disappears on its own is
          otherwise something to be argued with rather than understood.
        */}
        {overridden.value
          ? 'Some planes are set by hand.'
          : empty.value
            ? 'Shown while the scene is empty.'
            : 'Hidden while there is geometry.'}
        {overridden.value ? (
          <button
            type="button"
            class="zds-planes__reset"
            onClick={() => planes.resetOverrides()}
          >
            Reset
          </button>
        ) : null}
      </p>
    </div>
  )
}

/**
 * One plane.
 *
 * The eye toggles between shown and hidden — never back to `auto`, because a
 * click should do the obvious thing. Getting back to automatic is the section's
 * Reset, which is a deliberate act and belongs where it can be explained.
 */
function PlaneRow({ plane }: { plane: DefaultPlaneView }) {
  const planes = useService(defaultPlanesService)

  const next: PlaneVisibility = plane.visible ? 'hidden' : 'shown'

  return (
    <li class="zds-planes__row" data-back={plane.back ? 'true' : undefined}>
      <span class="zds-planes__name">{plane.title}</span>

      {plane.visibility === 'auto' ? null : (
        <span class="zds-planes__badge" title="Set by hand, not by the scene">
          set
        </span>
      )}

      <button
        type="button"
        class="zds-planes__visibility"
        data-hidden={plane.visible ? undefined : 'true'}
        aria-pressed={!plane.visible}
        aria-label={
          plane.visible
            ? `Hide the ${plane.title} plane`
            : `Show the ${plane.title} plane`
        }
        onClick={() => planes.set(plane.name, next)}
      >
        <Icon name={plane.visible ? 'eyeOpen' : 'eyeCrossedOut'} size="small" />
      </button>
    </li>
  )
}
