import { Popover } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { useViewControlMenuItems } from '@src/components/ViewControlMenu'
import CubeGizmo from '@src/components/gizmo/CubeGizmo'
import AxisGizmo from '@src/components/gizmo/AxisGizmo'
import { useSettings } from '@src/lib/singletons'

export default function Gizmo() {
  const menuItems = useViewControlMenuItems()
  const settings = useSettings()
  const gizmoType = settings.modeling.gizmoType.current

  return (
    <div className="relative">
      {gizmoType === 'axis' ? <AxisGizmo /> : <CubeGizmo />}
      <GizmoDropdown items={menuItems} />
    </div>
  )
}

function GizmoDropdown({ items }: { items: React.ReactNode[] }) {
  return (
    <Popover className="absolute top-0 right-0 pointer-events-auto">
      {({ close }) => (
        <>
          <Popover.Button className="border-none p-0 m-0 -translate-y-1/4 translate-x-1/4">
            <CustomIcon
              name="caretDown"
              className="w-4 h-4 ui-open:rotate-180"
            />
            <span className="sr-only">View settings</span>
          </Popover.Button>
          <Popover.Panel
            className={`absolute bottom-full right-0 mb-2 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
      border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
      shadow-lg`}
          >
            <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
              {items.map((item, index) => (
                <li key={index} className="contents" onClick={() => close()}>
                  {item}
                </li>
              ))}
            </ul>
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}
