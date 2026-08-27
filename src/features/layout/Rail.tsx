import { computed } from '@preact/signals'
import { useMemo } from 'preact/hooks'
import { Button, Split } from '@kittycad/ui-kit'
import type { LayoutService, RailNode } from '@src/contracts/layout'
import { AreaHost } from '@src/features/layout/AreaHost'
import './layout.css'

const MIN_EXTENT = 180
const MAX_EXTENT = 720

interface RailProps {
  node: RailNode
  layout: LayoutService
}

/**
 * An icon strip with collapsible areas behind it.
 *
 * Rails are how a dense tool keeps a dozen panels reachable while spending
 * screen on none of them. Sized in pixels rather than fractions, because a file
 * tree wants the same width at 1280 as at 3840.
 *
 * Collapsing to nothing is a supported state, not a degenerate one: the strip
 * on its own is a complete, usable rail.
 */
export function Rail({ node, layout }: RailProps) {
  const extent = layout.extentFor(node.id, 280)

  /**
   * The extent is handed to the element as a signal-valued `style`.
   *
   * Preact subscribes signals in DOM props directly, so a drag frame is one
   * style write rather than a re-render of the rail and everything inside it.
   *
   * Keyed on `extent` identity rather than built with `useComputed`: the
   * service hands out a fresh signal when a layout is reset, and a computed
   * memoised on mount would go on reporting the old one's value forever.
   */
  const regionStyle = useMemo(
    () => computed(() => `--zds-rail-extent:${extent.value}px`),
    [extent]
  )

  /**
   * Derived inline rather than through `useComputed`.
   *
   * A `useComputed` only re-evaluates when one of its *signal* dependencies
   * changes. These values also depend on `node`, which is a plain prop, so a
   * memoised computed would keep serving a stale answer after the layout tree
   * changed under it. Computing in the render body is correct on both counts:
   * prop changes re-render, and reading `.value` here subscribes this component
   * to the signals it touches.
   */
  const areas = node.areaIds
    .map((areaId) => layout.area(areaId))
    .filter((area): area is AreaFromLayout => Boolean(area))
    .filter((area) => area.available?.value ?? true)

  const openAreas = areas.filter((area) => node.openAreaIds.includes(area.id))

  const stackSizes = layout.sizesFor(`${node.id}:stack`)

  const beginResize = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()

    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)

    const startX = event.clientX
    const startExtent = extent.peek()
    // For a rail docked to the inline end, dragging left must widen it.
    const direction = node.side === 'inline-end' ? -1 : 1

    const onMove = (move: PointerEvent) => {
      const next = startExtent + (move.clientX - startX) * direction
      extent.value = Math.min(Math.max(next, MIN_EXTENT), MAX_EXTENT)
    }

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const nudge = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()

    const step =
      (event.shiftKey ? 40 : 12) * (event.key === 'ArrowRight' ? 1 : -1)
    const direction = node.side === 'inline-end' ? -1 : 1
    extent.value = Math.min(
      Math.max(extent.peek() + step * direction, MIN_EXTENT),
      MAX_EXTENT
    )
  }

  return (
    <div class="zds-rail-group" data-side={node.side}>
      <nav
        class="zds-rail"
        aria-label={node.side === 'inline-end' ? 'Right panels' : 'Left panels'}
      >
        {areas.map((area) => (
          <Button
            key={area.id}
            variant="chassis"
            iconOnly
            icon={area.icon}
            label={area.title}
            shortcut={area.shortcut}
            pressed={layout.isAreaOpen(area.id)}
            class="zds-rail__button"
            onClick={() => layout.toggleArea(area.id)}
          />
        ))}
      </nav>

      {openAreas.length > 0 ? (
        <div class="zds-rail__region" style={regionStyle}>
          {openAreas.length === 1 ? (
            <AreaHost
              area={openAreas[0]}
              nodeId={node.id}
              onClose={() => layout.closeArea(openAreas[0].id)}
            />
          ) : (
            <Split
              orientation="block"
              sizes={stackSizes}
              panes={openAreas.map((area) => ({
                id: area.id,
                minSize: 80,
                content: (
                  <AreaHost
                    area={area}
                    nodeId={node.id}
                    onClose={() => layout.closeArea(area.id)}
                  />
                ),
              }))}
            />
          )}
          <div
            class="zds-rail__handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
            tabIndex={0}
            onPointerDown={beginResize}
            onKeyDown={nudge}
          />
        </div>
      ) : null}
    </div>
  )
}

type AreaFromLayout = NonNullable<ReturnType<LayoutService['area']>>
