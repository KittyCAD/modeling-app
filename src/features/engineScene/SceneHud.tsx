import { Button, Icon } from '@kittycad/ui-kit'
import { signal } from '@preact/signals'
import { useOptionalService, useService, useValueSpec } from '@src/app/context'
import { layoutService } from '@src/contracts/layout'
import type { SceneHudSection, SceneHudService } from '@src/contracts/sceneHud'
import {
  sceneHudSectionsValueSpec,
  sceneHudService,
} from '@src/contracts/sceneHud'
import { inlineResizeHandlers } from '@src/features/layout/inlineResize'
import './sceneHud.css'

/**
 * How wide the outline starts, in pixels.
 *
 * Narrow on purpose. It sits over the model, so every pixel it takes is a pixel
 * of the thing being modelled — and a feature list is mostly short names, which
 * means most of a wide panel is empty. Somebody who wants more can drag for it,
 * and what they drag to is remembered.
 */
const DEFAULT_WIDTH = 208

/** As narrow as it can be dragged before it stops being readable. */
const MIN_WIDTH = 140

/** And as wide as it can get before it is just covering the model. */
const MAX_WIDTH = 520

/**
 * The width, remembered.
 *
 * Through the layout service's own extent facility rather than component state,
 * which is the difference between a width you set once and a width you set every
 * time you open a project: extents are persisted, and a drag, a restore and a
 * reset all write to the same signal.
 */
const WIDTH_NODE = 'scene.outline'

/**
 * Where the width lives when there is no layout service to remember it.
 *
 * A build without one is not a build with no outline: it is a build where the
 * width is not persisted, which is a smaller thing to lose than the panel.
 * Module-level so it at least survives a remount.
 */
const fallbackWidth = signal(DEFAULT_WIDTH)

function HudSection({
  section,
  hud,
}: {
  section: SceneHudSection
  hud: SceneHudService
}) {
  /*
   * Read from the service, not from local state, so the chevron and the
   * section's keybinding move the same value. `defaultCollapsed` seeds it the
   * first time this section is mentioned and is ignored afterwards, which is
   * what makes the fold survive a remount.
   */
  const open = hud.sectionOpen(section.id, !section.defaultCollapsed).value

  return (
    <section
      class="zds-scene-hud__section"
      data-section-id={section.id}
      data-open={open ? 'true' : undefined}
    >
      <header class="zds-scene-hud__heading">
        <button
          type="button"
          class="zds-scene-hud__toggle"
          aria-expanded={open}
          onClick={() => hud.toggleSection(section.id)}
        >
          <Icon name="chevronRight" size="small" />
          {section.icon ? <Icon name={section.icon} size="small" /> : null}
          <span class="zds-scene-hud__title">{section.title}</span>
        </button>
        {section.headerActions ? (
          <span class="zds-scene-hud__actions">{section.headerActions()}</span>
        ) : null}
      </header>
      {open ? (
        <div class="zds-scene-hud__section-body">{section.render()}</div>
      ) : null}
    </section>
  )
}

/**
 * The extensible outline HUD at the scene's start edge.
 *
 * This component knows how sections stack, fold and scroll, but not what any
 * section represents. It is mounted as one scene-zone contribution so adding a
 * second section extends the existing surface instead of creating another
 * unrelated floating panel.
 */
export function SceneHud() {
  const sections = useValueSpec(sceneHudSectionsValueSpec)
  const layout = useOptionalService(layoutService)
  const hud = useService(sceneHudService)
  const width = layout?.extentFor(WIDTH_NODE, DEFAULT_WIDTH) ?? fallbackWidth
  const collapsed = hud.collapsed.value

  /**
   * Drag the edge, through the handlers the rails already use.
   *
   * Shared rather than written again: pointer capture, the clamp and the fact
   * that a handle is a `separator` a keyboard can nudge are all easy to get
   * subtly different, and I had already got them subtly different here before
   * noticing this existed. Arrow keys come with it.
   */
  const resize = inlineResizeHandlers(width, {
    // The panel is to the left of its handle, so rightward widens.
    direction: 1,
    min: MIN_WIDTH,
    max: MAX_WIDTH,
  })

  const visible = sections.value.filter(
    (section) => section.visible?.value ?? true
  )

  if (visible.length === 0) {
    return null
  }

  return (
    /*
     * A frame around the panel, so the handle can be beside it rather than in it.
     *
     * The panel clips its own contents — that is what keeps a long list inside
     * the rounded corners — and `overflow` cannot be `hidden` in one axis and
     * `visible` in the other: CSS computes `visible` to `auto` as soon as its
     * partner is not, which would have given the panel a horizontal scrollbar
     * whose only content was the handle. So the handle is a sibling.
     */
    <div class="zds-scene-hud-frame">
      <aside
        class="zds-scene-hud"
        aria-label="Scene outline"
        data-collapsed={collapsed ? 'true' : undefined}
        style={collapsed ? undefined : { inlineSize: `${width.value}px` }}
      >
        {/*
        Ghost, not chassis. The chassis variant exists for buttons that tile into
        a strip, and it pays for that with `block-size: 100%` and its own padding
        — both of which win over `size` because they are declared later in the
        same file. In a strip that is invisible; here it made the button as tall
        as the outline, and then squeezed the chevron out of a square too small
        to hold an icon and two paddings.
      */}
        <Button
          class="zds-scene-hud__collapse"
          variant="ghost"
          size="small"
          icon={collapsed ? 'chevronRight' : 'chevronLeft'}
          iconOnly
          label={collapsed ? 'Expand scene outline' : 'Collapse scene outline'}
          onClick={() => hud.toggleCollapsed()}
          aria-expanded={!collapsed}
        />
        {!collapsed ? (
          <div class="zds-scene-hud__contents">
            {visible.map((section) => (
              <HudSection key={section.id} section={section} hud={hud} />
            ))}
          </div>
        ) : null}
      </aside>

      {/*
        The resize handle, just outside the edge it moves.
        Outside rather than on the border because the border is one hairline and
        a hairline is not a pointer target — and inside would put it over the
        list, where it would compete with the rows for the same clicks. A wide
        invisible strip beyond the panel belongs to nothing else, so it can be
        generous without taking anything away.

        A separator with an `aria-valuenow` rather than a plain div: it is a real
        control, and one that can be moved by keyboard once somebody asks for
        that.
      */}
      {collapsed ? null : (
        <div
          class="zds-scene-hud__resize"
          role="separator"
          aria-label="Resize scene outline"
          aria-orientation="vertical"
          aria-valuenow={width.value}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          onPointerDown={resize.onPointerDown}
          onKeyDown={resize.onKeyDown}
          onDblClick={() => {
            width.value = DEFAULT_WIDTH
          }}
        />
      )}
    </div>
  )
}
