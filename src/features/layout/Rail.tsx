import { computed } from '@preact/signals'
import { useMemo } from 'preact/hooks'
import { Button, Split } from '@kittycad/ui-kit'
import type { LayoutService, RailNode } from '@src/contracts/layout'
import { AreaHost } from '@src/features/layout/AreaHost'
import { inlineResizeHandlers } from '@src/features/layout/inlineResize'
import './layout.css'

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
  // Seeded from the node, so a preset that asks for a 560px code panel gets one.
  // The rail used to pass a constant here, which quietly ignored every preset's
  // stated size.
  const extent = layout.extentFor(node.id, node.size)

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
    // A hosted area is listed here for its state and its toggle, but another
    // area draws it — so it gets neither an icon here nor a slot in the region.
    .filter((area) => !area.hostedBy)

  const openAreas = areas.filter((area) => node.openAreaIds.includes(area.id))

  const stackSizes = layout.sizesFor(`${node.id}:stack`)

  const resize = inlineResizeHandlers(extent, {
    // A rail docked to the inline end widens as the pointer moves left.
    direction: node.side === 'inline-end' ? -1 : 1,
    min: node.minExtent,
    max: node.maxExtent,
  })

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
            onPointerDown={resize.onPointerDown}
            onKeyDown={resize.onKeyDown}
          />
        </div>
      ) : null}
    </div>
  )
}

type AreaFromLayout = NonNullable<ReturnType<LayoutService['area']>>
