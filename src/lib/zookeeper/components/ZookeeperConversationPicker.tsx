import { Menu } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { reportRejection } from '@src/lib/trap'
import type { ZookeeperConversationDetails } from '@src/lib/zookeeper/conversationDetails'
import type { ZookeeperSessionController } from '@src/lib/zookeeper/registry/controller'
import { useEffect, useState } from 'react'

export interface ZookeeperConversationPickerProps {
  controller: ZookeeperSessionController
  currentPrompt?: string
  onSelect: (conversationId: string) => void
  onNewChat: () => void
}

const conversationLabel = (id: string, prompt?: string) =>
  prompt?.trim() || `Chat ${id.slice(0, 8)}`

export function ZookeeperConversationPicker(
  props: ZookeeperConversationPickerProps
) {
  useSignals()
  const { controller } = props
  const [details, setDetails] = useState<ZookeeperConversationDetails>({})
  const currentId = controller.currentConversationId.value
  const disabled = controller.isClearingChat.value
  const label = currentId
    ? conversationLabel(
        currentId,
        details[currentId]?.first_prompt || props.currentPrompt
      )
    : 'New chat'

  return (
    <div className="relative flex min-w-0 shrink-0 items-center gap-1 border-b border-chalkboard-20 px-2 py-1 dark:border-chalkboard-80">
      <Menu as="div" className="min-w-0 flex-1">
        <Menu.Button
          disabled={disabled || controller.conversationIds.value.length === 0}
          aria-label="Choose conversation"
          className="m-0 flex h-8 w-full min-w-0 items-center gap-2 rounded-sm border-transparent px-2 text-left text-sm hover:bg-2 disabled:opacity-60"
        >
          <CustomIcon name="chat" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={label}>
            {label}
          </span>
          <CustomIcon name="caretDown" className="h-4 w-4 shrink-0" />
        </Menu.Button>
        <Menu.Items className="absolute inset-x-2 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded border border-chalkboard-20 bg-default p-1 shadow-lg focus:outline-none dark:border-chalkboard-80">
          <ConversationOptions
            {...props}
            details={details}
            onDetails={setDetails}
          />
        </Menu.Items>
      </Menu>
      <button
        type="button"
        aria-label="New chat"
        disabled={disabled || controller.conversationIds.value.length === 0}
        onClick={props.onNewChat}
        className="relative m-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border-transparent p-0 hover:bg-2 disabled:opacity-60"
      >
        <CustomIcon name="plus" className="h-5 w-5" />
        <Tooltip position="bottom-left" hoverOnly>
          New chat
        </Tooltip>
      </button>
    </div>
  )
}

function ConversationOptions({
  controller,
  currentPrompt,
  onSelect,
  details,
  onDetails,
}: ZookeeperConversationPickerProps & {
  details: ZookeeperConversationDetails
  onDetails: (details: ZookeeperConversationDetails) => void
}) {
  useSignals()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setFailed(false)
    void controller
      .loadConversationDetails(abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) onDetails(next)
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return
        reportRejection(error)
        setFailed(true)
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [controller, onDetails, attempt])

  const currentId = controller.currentConversationId.value
  return (
    <>
      {[...controller.conversationIds.value].reverse().map((id) => {
        const current = id === currentId
        const label = conversationLabel(
          id,
          details[id]?.first_prompt || (current ? currentPrompt : undefined)
        )
        const createdAt = details[id]?.created_at
        const date = createdAt ? new Date(createdAt) : undefined
        return (
          <Menu.Item key={id}>
            {({ active }) => (
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => onSelect(id)}
                className={`m-0 flex w-full min-w-0 items-center gap-2 rounded-sm border-transparent px-2 py-2 text-left text-sm ${active ? 'bg-2' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={label}>
                    {label}
                  </span>
                  {date && !Number.isNaN(date.getTime()) && (
                    <time
                      dateTime={createdAt}
                      className="block text-xs text-chalkboard-60 dark:text-chalkboard-40"
                    >
                      {date.toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </time>
                  )}
                </span>
                <span className="h-4 w-4 shrink-0">
                  {current && (
                    <CustomIcon name="checkmark" className="h-4 w-4" />
                  )}
                </span>
              </button>
            )}
          </Menu.Item>
        )
      })}
      {loading && (
        <p
          role="status"
          className="px-2 py-1 text-xs text-chalkboard-60 dark:text-chalkboard-40"
        >
          Loading chat labels...
        </p>
      )}
      {failed && (
        <div className="flex items-center justify-between gap-2 border-t border-chalkboard-20 px-2 py-1 text-xs dark:border-chalkboard-80">
          <span role="status">Could not load chat labels.</span>
          <Menu.Item>
            {({ active }) => (
              <button
                type="button"
                className={`underline ${active ? 'bg-2' : ''}`}
                onClick={(event) => {
                  event.preventDefault()
                  setAttempt((value) => value + 1)
                }}
              >
                Retry
              </button>
            )}
          </Menu.Item>
        </div>
      )}
    </>
  )
}
