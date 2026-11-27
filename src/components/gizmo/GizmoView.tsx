import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ReactElement } from 'react'
import type { ResolvedTheme } from '@src/lib/theme'
import { Popover } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { AxisGizmoView } from '@src/components/gizmo/AxisGizmoView'
import { CubeGizmoView } from '@src/components/gizmo/CubeGizmoView'

export function GizmoView({
  sceneInfra,
  gizmoType,
  theme,
  menuItems,
  disabled = false,
}: {
  sceneInfra: Pick<SceneInfra, 'camControls'>
  gizmoType: 'axis' | 'cube'
  theme: ResolvedTheme
  menuItems: ReactElement[]
  disabled?: boolean
}) {
  return (
    <div className="relative">
      {gizmoType === 'axis' ? (
        <AxisGizmoView
          sceneInfra={sceneInfra}
          disabled={disabled}
          menuItems={menuItems}
        />
      ) : (
        <CubeGizmoView
          sceneInfra={sceneInfra}
          resolvedTheme={theme}
          disableOrbit={disabled}
        />
      )}
      <GizmoDropdown items={menuItems} />
    </div>
  )
}

function GizmoDropdown({ items }: { items: React.ReactElement[] }) {
  return (
    <Popover className="absolute top-0 right-0 pointer-events-auto">
      {(popover) => (
        <>
          <Popover.Button className="border-none p-0 m-0 -translate-y-1/4 translate-x-1/4">
            <CustomIcon
              name="caretDown"
              className="w-4 h-4 ui-open:rotate-180"
            />
            <span className="sr-only">View settings</span>
          </Popover.Button>
          <Popover.Panel
            data-testid="gizmo-view-menu"
            className={`absolute bottom-full right-0 mb-2 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
      border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
      shadow-lg`}
          >
            <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
              {items.map((item, index) => (
                <li
                  key={index}
                  className="contents"
                  onClick={() => popover.close()}
                >
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
