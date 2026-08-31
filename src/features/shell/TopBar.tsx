import { useComputed } from '@preact/signals'
import type { ShellItem, ShellZone } from '@src/contracts/shell'
import { topBarItemsValueSpec } from '@src/contracts/shell'
import { runtimeService } from '@src/contracts/runtime'
import { useService, useValueSpec } from '@src/app/context'
import './shell.css'

function Zone({ items, zone }: { items: ShellItem[]; zone: ShellZone }) {
  const visible = items.filter(
    (item) => item.zone === zone && (item.visible?.value ?? true)
  )
  if (visible.length === 0) return null

  return (
    <div class="zds-topbar__zone" data-zone={zone}>
      {visible.map((item) => (
        <div class="zds-topbar__item" data-item-id={item.id} key={item.id}>
          {item.render()}
        </div>
      ))}
    </div>
  )
}

/**
 * The top strip of the chassis.
 *
 * Holds no application knowledge at all — it renders three zones of
 * contributed items. Adding something to the top bar never touches this file.
 */
export function TopBar() {
  const items = useValueSpec(topBarItemsValueSpec)
  const runtime = useService(runtimeService)

  /*
   * Room for the traffic lights, on the one platform that puts them inside the
   * window. `hiddenInset` insets them over the top-left of the content, so
   * without this the brand sits underneath them — and the whole strip is a drag
   * region, so it is not even obvious that something is covered.
   */
  const insetForTrafficLights = useComputed(() => runtime.info.value.isMac)

  return (
    <header
      class="zds-topbar zds-seam-block-end zds-drag-region"
      data-traffic-lights={insetForTrafficLights.value ? '' : undefined}
    >
      <Zone items={items.value} zone="start" />
      <Zone items={items.value} zone="center" />
      <Zone items={items.value} zone="end" />
    </header>
  )
}
