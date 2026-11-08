import { TabPicker } from '@kittycad/ui-components'
import { CustomIcon } from '@src/components/CustomIcon'

/** The editor shell supplies mode terminology and app icons to the generic tab accessory. */
export function TabViewPicker({
  name,
  view,
  views,
  onFocus,
  onChange,
}: {
  name: string
  view: { id: string; label: string } | undefined
  views: readonly { id: string; label: string }[]
  onFocus: () => void
  onChange: (viewId: string) => void
}) {
  return (
    <TabPicker
      label={`Mode for ${name}`}
      title="Choose mode"
      placeholder="Unavailable mode"
      value={view?.id}
      options={views}
      onFocus={onFocus}
      onChange={onChange}
      expandIcon={
        <CustomIcon name="caretDown" className="h-3 w-3 shrink-0" aria-hidden />
      }
      selectedIcon={
        <CustomIcon name="checkmark" className="h-3 w-3" aria-hidden />
      }
    />
  )
}
