import type { ShellItem, ShellZone } from '@src/contracts/shell'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import { useValueSpec } from '@src/app/context'
import './shell.css'

function Zone({ items, zone }: { items: ShellItem[]; zone: ShellZone }) {
  const visible = items.filter(
    (item) => item.zone === zone && (item.visible?.value ?? true)
  )
  if (visible.length === 0) return null

  return (
    <div class="zds-statusbar__zone" data-zone={zone}>
      {visible.map((item) => (
        <div class="zds-statusbar__item" data-item-id={item.id} key={item.id}>
          {item.render()}
        </div>
      ))}
    </div>
  )
}

/**
 * The bottom strip of the chassis.
 *
 * Reads as one continuous readout rather than a row of controls: mono
 * throughout, hairline-divided, at the smallest size in the type scale. It is
 * where the app answers "is anything wrong" without being asked.
 */
export function StatusBar() {
  const items = useValueSpec(statusBarItemsValueSpec)

  return (
    <footer class="zds-statusbar zds-seam-block-start">
      <Zone items={items.value} zone="start" />
      <Zone items={items.value} zone="center" />
      <Zone items={items.value} zone="end" />
    </footer>
  )
}
