import { Button, Icon } from '@kittycad/ui-kit'
import { useValueSpec } from '@src/app/context'
import type { SceneHudSection } from '@src/contracts/sceneHud'
import { sceneHudSectionsValueSpec } from '@src/contracts/sceneHud'
import { useState } from 'preact/hooks'
import './sceneHud.css'

function HudSection({ section }: { section: SceneHudSection }) {
  const [open, setOpen] = useState(!section.defaultCollapsed)

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
          onClick={() => setOpen((current) => !current)}
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
  const [collapsed, setCollapsed] = useState(false)
  const visible = sections.value.filter(
    (section) => section.visible?.value ?? true
  )

  if (visible.length === 0) {
    return null
  }

  return (
    <aside
      class="zds-scene-hud"
      aria-label="Scene outline"
      data-collapsed={collapsed ? 'true' : undefined}
    >
      <Button
        class="zds-scene-hud__collapse"
        variant="chassis"
        size="small"
        icon={collapsed ? 'chevronRight' : 'chevronLeft'}
        iconOnly
        label={collapsed ? 'Expand scene outline' : 'Collapse scene outline'}
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
      />
      {!collapsed ? (
        <div class="zds-scene-hud__contents">
          {visible.map((section) => (
            <HudSection key={section.id} section={section} />
          ))}
        </div>
      ) : null}
    </aside>
  )
}
