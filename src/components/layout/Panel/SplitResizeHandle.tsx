import { CustomIcon } from '@src/components/CustomIcon'
import type { ComponentProps } from 'react'
import { PanelResizeHandle } from 'react-resizable-panels'

const COMFORTABLE_HIT_AREA_MARGINS = { coarse: 15, fine: 8 } as const

type SplitResizeHandleProps = {
  direction: 'horizontal' | 'vertical'
  disabled?: boolean
  id: string
  onDragging?: ComponentProps<typeof PanelResizeHandle>['onDragging']
  showGrabber?: boolean
  testId?: string
  transparent?: boolean
  visible?: boolean
}

export function SplitResizeHandle({
  direction,
  disabled = false,
  id,
  onDragging,
  showGrabber = true,
  testId,
  transparent = false,
  visible = true,
}: SplitResizeHandleProps) {
  const horizontal = direction === 'horizontal'
  const sizeClassName = visible
    ? horizontal
      ? 'w-px cursor-col-resize'
      : 'h-px cursor-row-resize'
    : horizontal
      ? 'w-0'
      : 'h-0'
  const colorClassName = transparent
    ? disabled
      ? 'bg-transparent'
      : 'bg-transparent hover:bg-4 focus-visible:bg-4 data-[resize-handle-state=drag]:bg-4'
    : disabled
      ? 'bg-default'
      : 'bg-3 hover:bg-4 focus-visible:bg-4 data-[resize-handle-state=drag]:bg-4'

  return (
    <PanelResizeHandle
      className={`group/handle relative z-30 flex-none focus-visible:outline-none ${sizeClassName} ${colorClassName}`}
      data-testid={testId}
      disabled={disabled || !visible}
      hitAreaMargins={COMFORTABLE_HIT_AREA_MARGINS}
      id={id}
      onDragging={onDragging}
    >
      {showGrabber && visible && !disabled ? (
        <div
          className={`absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 place-content-center rounded-sm border bg-3 py-1 group-data-[resize-handle-state=hover]/handle:grid group-data-[resize-handle-state=drag]/handle:grid ${horizontal ? '' : 'rotate-90'}`}
          data-testid="resize-handle-grabber"
        >
          <CustomIcon className="-mx-0.5 h-4 w-4 rotate-90" name="sixDots" />
        </div>
      ) : null}
    </PanelResizeHandle>
  )
}
