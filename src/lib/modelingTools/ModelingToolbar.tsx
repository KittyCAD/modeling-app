import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { ToolbarDropdownPanel } from '@src/components/ToolbarDropdownPanel'
import type {
  ModelingTarget,
  ModelingToolsService,
  ResolvedModelingTool,
} from '@src/lib/modelingTools/registry/contract'
import { useRef } from 'react'
import toast from 'react-hot-toast'
import styles from './ModelingToolbar.module.css'

/** Render registered commands as tools; the service owns eligibility and command selection. */
export function ModelingToolbar({
  tools,
  target,
}: {
  tools: ModelingToolsService
  target: ModelingTarget
}) {
  useSignals()
  const resolved = tools.resolve(target)
  const groups = Map.groupBy(
    resolved,
    (item) => item.tool.group ?? item.tool.id
  )
  const invoke = (item: ResolvedModelingTool) => {
    const error = tools.invoke(item.tool.id, target)
    if (error) toast.error(error.message)
  }
  return (
    <div role="toolbar" aria-label="Modeling tools" className={styles.toolbar}>
      {[...groups].map(([id, items]) =>
        items.length === 1 ? (
          <ToolButton key={id} item={items[0]} invoke={invoke} />
        ) : (
          <ToolGroup key={id} label={id} items={items} invoke={invoke} />
        )
      )}
    </div>
  )
}

function ToolButton({
  item,
  invoke,
}: {
  item: ResolvedModelingTool
  invoke: (item: ResolvedModelingTool) => void
}) {
  return (
    <span title={item.unavailableReason ?? item.description}>
      <button
        type="button"
        className={styles.button}
        disabled={!!item.unavailableReason}
        onClick={() => invoke(item)}
      >
        <span aria-hidden="true">
          <CustomIcon name={item.tool.icon} className="h-5 w-5" />
        </span>
        {item.label}
      </button>
    </span>
  )
}

function ToolGroup({
  label,
  items,
  invoke,
}: {
  label: string
  items: readonly ResolvedModelingTool[]
  invoke: (item: ResolvedModelingTool) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <Popover className={styles.group}>
      {(popover) => (
        <>
          <ToolButton item={items[0]} invoke={invoke} />
          <Popover.Button
            ref={ref}
            className={styles.button}
            aria-label={`${label}: more tools`}
          >
            <span aria-hidden="true">
              <CustomIcon name="caretDown" className="h-3 w-3" />
            </span>
          </Popover.Button>
          <ToolbarDropdownPanel buttonRef={ref} open={popover.open}>
            {items.map((item) => (
              <li key={item.tool.id} title={item.unavailableReason}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={!!item.unavailableReason}
                  onClick={() => {
                    invoke(item)
                    popover.close()
                  }}
                >
                  <span aria-hidden="true">
                    <CustomIcon name={item.tool.icon} className="h-4 w-4" />
                  </span>
                  {item.label}
                </button>
              </li>
            ))}
          </ToolbarDropdownPanel>
        </>
      )}
    </Popover>
  )
}
