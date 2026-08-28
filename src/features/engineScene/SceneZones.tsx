import { useValueSpec } from '@src/app/context'
import type { SceneItem, SceneZone } from '@src/contracts/scene'
import { sceneItemsValueSpec } from '@src/contracts/scene'
import './sceneZones.css'

const ZONES: readonly SceneZone[] = ['top', 'start', 'end', 'bottom']

function Zone({ items, zone }: { items: SceneItem[]; zone: SceneZone }) {
  const visible = items.filter(
    (item) => item.zone === zone && (item.visible?.value ?? true)
  )
  if (visible.length === 0) return null

  return (
    <div class="zds-scene-zone" data-zone={zone}>
      {visible.map((item) => (
        <div class="zds-scene-zone__item" data-item-id={item.id} key={item.id}>
          {item.render()}
        </div>
      ))}
    </div>
  )
}

/**
 * Contributed controls over the scene.
 *
 * Four edges of contributions and no knowledge of what any of them are — the
 * same arrangement as the top bar, one layer in. A toolbar, a view gizmo, a
 * units readout: the surface that draws geometry accumulates none of them.
 *
 * Rendered by the viewport rather than by the stream, so an item is on screen in
 * every state the viewport has. A toolbar that appears only once frames arrive
 * would vanish exactly when someone is trying to work out why they have not.
 */
export function SceneZones() {
  const items = useValueSpec(sceneItemsValueSpec)

  return (
    <>
      {ZONES.map((zone) => (
        <Zone key={zone} items={items.value} zone={zone} />
      ))}
    </>
  )
}
