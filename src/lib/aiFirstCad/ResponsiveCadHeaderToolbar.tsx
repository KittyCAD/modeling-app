import { useModelingContext } from '@src/hooks/useModelingContext'
import { HeaderToolbarMenu } from '@src/lib/aiFirstCad/HeaderToolbarMenu'
import { getResponsiveToolbarLayout } from '@src/lib/aiFirstCad/responsiveToolbar'
import {
  modelingMachineStateToToolbarModeName,
  useToolbarConfig,
} from '@src/lib/toolbar'
import { SketchPlaneSelectionPrompt, Toolbar } from '@src/Toolbar'
import { useEffect, useMemo, useRef, useState } from 'react'

export function ResponsiveCadHeaderToolbar({
  align = 'center',
  ariaLabel,
  panelTestId,
  testId,
}: {
  align?: 'center' | 'end'
  ariaLabel: string
  panelTestId: string
  testId: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState<number | null>(null)
  const { state } = useModelingContext()
  const toolbarConfig = useToolbarConfig()
  const toolbarMode = modelingMachineStateToToolbarModeName(state)
  const entries = toolbarConfig[toolbarMode].items

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateWidth = () => {
      setAvailableWidth(container.getBoundingClientRect().width)
    }
    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const { expandedDropdownItemIds, hiddenItemIds } = useMemo(
    () => getResponsiveToolbarLayout(entries, availableWidth),
    [availableWidth, entries]
  )

  return (
    <div
      ref={containerRef}
      className={`relative flex w-full min-w-0 items-center gap-1 ${
        align === 'end' ? 'justify-end' : 'justify-center'
      }`}
      data-testid={testId}
    >
      <div className="min-w-0 overflow-hidden">
        <Toolbar
          embedded
          expandedDropdownItemIds={expandedDropdownItemIds}
          hiddenItemIds={hiddenItemIds}
          hideSketchPlanePrompt
        />
      </div>
      {hiddenItemIds.length > 0 ? (
        <HeaderToolbarMenu
          ariaLabel={ariaLabel}
          panelTestId={panelTestId}
          title="More modeling tools"
          visibleItemIds={hiddenItemIds}
        />
      ) : null}
      {state.matches('Sketch no face') ? (
        <SketchPlaneSelectionPrompt className="absolute left-1/2 top-full z-30 -translate-x-1/2 whitespace-nowrap" />
      ) : null}
    </div>
  )
}
