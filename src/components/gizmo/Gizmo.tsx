import { Popover } from '@headlessui/react'
import { useEffect, useRef } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  ViewControlContextMenu,
  useViewControlMenuItems,
} from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { useSettings } from '@src/lib/singletons'
import GizmoRenderer from '@src/components/gizmo/GizmoRenderer'

export default function Gizmo() {
  const { state: modelingState } = useModelingContext()
  const settings = useSettings()
  const resolvedTheme = useResolvedTheme()
  const menuItems = useViewControlMenuItems()
  const wrapperRef = useRef<HTMLDivElement>(null!)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const disableOrbitRef = useRef(false)

  const renderer = useRef<GizmoRenderer | null>(null)

  const isPerspective =
    settings.modeling.cameraProjection.current === 'perspective'
  const initialIsPerspectiveRef = useRef(isPerspective)
  const initialResolvedThemeRef = useRef(resolvedTheme)

  // onMount
  useEffect(() => {
    if (canvasRef.current) {
      renderer.current = new GizmoRenderer(
        canvasRef.current,
        initialIsPerspectiveRef.current,
        initialResolvedThemeRef.current
      )
    }
  }, [])

  // perspective changed
  useEffect(() => {
    renderer.current?.setPerspective(isPerspective)
  }, [isPerspective])

  // theme changed
  useEffect(() => {
    renderer.current?.setTheme(resolvedTheme)
  }, [resolvedTheme])

  // Temporary fix for #4040:
  // Disable gizmo orbiting in sketch mode
  // This effect updates disableOrbitRef whenever the user
  // toggles between Sketch mode and 3D mode
  useEffect(() => {
    const disabled =
      modelingState.matches('Sketch') &&
      !settings.app.allowOrbitInSketchMode.current

    renderer.current?.setDisabled(disabled)
    if (wrapperRef.current) {
      // wrapperRef.current.style.filter = disableOrbitRef.current
      //   ? 'grayscale(100%)'
      //   : 'none'
      wrapperRef.current.style.cursor = disabled ? 'not-allowed' : 'auto'
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [modelingState, settings.app.allowOrbitInSketchMode.current])

  return (
    <div className="relative">
      <div
        ref={wrapperRef}
        aria-label="View orientation gizmo"
        data-testid={`gizmo${disableOrbitRef.current ? '-disabled' : ''}`}
        className="grid place-content-center rounded-full overflow-hidden border border-solid border-primary/50 pointer-events-auto bg-chalkboard-10/70 dark:bg-chalkboard-100/80 backdrop-blur-sm"
      >
        <canvas ref={canvasRef} />
        <ViewControlContextMenu menuTargetElement={wrapperRef} />
      </div>
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
