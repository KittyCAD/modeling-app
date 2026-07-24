import { Popover } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ExchangeCard } from '@src/components/ExchangeCard'
import { isExternalFileDrag } from '@src/components/Explorer/utils'
import Loading from '@src/components/Loading'
import { MakeathonAnnouncement } from '@src/components/MakeathonAnnouncement'
import Tooltip from '@src/components/Tooltip'
import { noAutofillInputProps } from '@src/lib/autofill'
import { useApp, useSingletons } from '@src/lib/boot'
import { dataUrlToFile, takeViewportScreenshot } from '@src/lib/screenshot'
import { getSelectionTypeDisplayText } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { isNonNullable } from '@src/lib/utils'
import type {
  Conversation,
  Exchange,
  MlCopilotModeId,
  MlCopilotModeOption,
} from '@src/lib/zookeeper/mlEphantManagerMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  activateZoodleRuntimeExtension,
  deactivateZoodleRuntimeExtension,
} from '@src/registry/extensions/engineScene/zoodleRuntimeExtension'
import type { ChangeEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

const noop = () => {}

export const SHOW_ZOOKEEPER_REASONING_MODE_DROPDOWN = true

export interface QueuedMessage {
  id: string
  text: string
  mode?: MlCopilotModeId
  attachments: File[]
}

export interface MlEphantConversationProps {
  isLoading: boolean
  conversation?: Conversation
  contexts: MlEphantManagerPromptContext[]
  // Callers can provide a local component today, then swap to a remotely
  // authored source later without changing the conversation layout below.
  welcomeMessage?: ReactNode
  onProcess: (
    request: string,
    mode: MlCopilotModeId | undefined,
    attachments: File[]
  ) => void
  onCancel: () => void
  onClickClearChat: () => void
  onReconnect: () => void
  disabled?: boolean
  needsReconnect: boolean
  hasPromptCompleted: boolean
  userAvatarSrc?: string
  showMakeathonAnnouncement?: boolean
  blockedReason?: string
  defaultPrompt?: string
  initialMlCopilotMode?: MlCopilotModeId // resolved from settings/server metadata
  onMlCopilotModeChange?: (mode: MlCopilotModeId | undefined) => void
  isProcessing: boolean
  queue: QueuedMessage[]
  onRemoveFromQueue: (id: string) => void
  onSteer: (id: string) => void
  modeOptions?: MlCopilotModeOption[]
  modeScopeKey?: string
}

const getModeOption = (
  mode: MlCopilotModeId | undefined,
  modeOptions?: MlCopilotModeOption[]
): MlCopilotModeOption | undefined =>
  modeOptions?.find((option) => option.id === mode)

const getFirstEnabledModeOption = (
  modeOptions?: MlCopilotModeOption[]
): MlCopilotModeOption | undefined =>
  modeOptions?.find((option) => !option.disabled)

export interface MlCopilotModesProps {
  onClick: (mode: MlCopilotModeId) => void
  children: ReactNode
  current?: MlCopilotModeId
  modeOptions: MlCopilotModeOption[]
}

const MlCopilotModes = (props: MlCopilotModesProps) => {
  return (
    <>
      <Popover className="relative min-w-0 max-w-full">
        <Popover.Button
          data-testid="ml-copilot-efforts-button"
          className="h-7 max-w-full min-w-0 bg-default flex flex-row items-center gap-1 m-0 pl-1 pr-1.5 rounded-sm"
        >
          {props.children}
          <CustomIcon
            name="caretUp"
            className="w-5 h-5 flex-none ui-open:rotate-180"
          />
        </Popover.Button>

        <Popover.Panel className="absolute bottom-full left-0 z-20 flex flex-col gap-2 bg-default mb-1 p-2 border border-chalkboard-70 text-xs rounded-md min-w-[240px]">
          {({ close }) => (
            <>
              {props.modeOptions.map((mode) => (
                <button
                  type="button"
                  disabled={mode.disabled}
                  key={mode.id}
                  onClick={() => {
                    if (mode.disabled) return
                    close()
                    props.onClick(mode.id)
                  }}
                  className={`flex flex-row items-start gap-2 text-left cursor-pointer hover:bg-3 p-2 pr-4 rounded-md border disabled:cursor-not-allowed disabled:opacity-70 ${props.current === mode.id ? 'border-primary' : ''}`}
                  data-testid={`ml-copilot-effort-button-${mode.id}`}
                >
                  <CustomIcon
                    name={mode.icon}
                    className="w-5 h-5 shrink-0 mt-0.5"
                  />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-medium">{mode.label}</span>
                    <span className="text-chalkboard-70 text-[11px] leading-tight">
                      {mode.description}
                    </span>
                    {mode.disabled && (
                      <span className="text-chalkboard-70 text-[11px] leading-tight">
                        Upgrade your plan to use this mode
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}
        </Popover.Panel>
      </Popover>
    </>
  )
}

export interface MlEphantExtraInputsProps {
  // TODO: Expand to a list with no type restriction
  context?: Extract<MlEphantManagerPromptContext, { type: 'selections' }>
  mode?: MlCopilotModeId
  onSetMode: (mode: MlCopilotModeId) => void
  onAttachFiles: () => void
  onCaptureScreenshot: () => void
  onAnnotateScreenshot: () => void
  attachmentsDisabled?: boolean
  isZoodleActive?: boolean
  modeOptions?: MlCopilotModeOption[]
}

export const MlEphantExtraInputs = (props: MlEphantExtraInputsProps) => {
  const currentMode = getModeOption(props.mode, props.modeOptions)
  const modeOptions = props.modeOptions ?? []

  return (
    <div
      className="flex min-w-0 flex-1 items-end"
      data-testid="ml-ephant-extra-inputs"
    >
      <div className="flex w-full min-w-0 flex-wrap items-end gap-1">
        {/* TODO: Generalize to a MlCopilotContexts component */}
        {props.context && (
          <MlCopilotSelectionsContext selections={props.context} />
        )}
        {SHOW_ZOOKEEPER_REASONING_MODE_DROPDOWN && currentMode && (
          <MlCopilotModes
            onClick={props.onSetMode}
            current={props.mode}
            modeOptions={modeOptions}
          >
            <CustomIcon name={currentMode.icon} className="w-5 h-5 flex-none" />
            <span className="min-w-0 truncate">{currentMode.label}</span>
          </MlCopilotModes>
        )}
        <button
          type="button"
          data-testid="ml-ephant-attachments-button"
          onClick={props.onAttachFiles}
          disabled={props.attachmentsDisabled}
          className="h-7 w-7 bg-default flex items-center justify-center rounded-sm m-0 p-0 flex-none disabled:opacity-60"
          aria-label="Attach files"
        >
          <CustomIcon name="paperclip" className="w-5 h-5" />
          <Tooltip position="top" hoverOnly={true}>
            <span>Attach files</span>
          </Tooltip>
        </button>
        <button
          type="button"
          data-testid="ml-ephant-screenshot-button"
          onClick={props.onCaptureScreenshot}
          disabled={props.attachmentsDisabled}
          className="h-7 w-7 bg-default flex items-center justify-center rounded-sm m-0 p-0 flex-none disabled:opacity-60"
          aria-label="Capture viewport screenshot"
        >
          <CustomIcon name="camera" className="w-5 h-5" />
          <Tooltip position="top" hoverOnly={true}>
            <span>Capture viewport screenshot</span>
          </Tooltip>
        </button>
        <button
          type="button"
          data-testid="ml-ephant-annotate-screenshot-button"
          onClick={props.onAnnotateScreenshot}
          disabled={props.attachmentsDisabled && !props.isZoodleActive}
          aria-pressed={props.isZoodleActive ?? false}
          className={`h-7 w-7 flex items-center justify-center rounded-sm m-0 p-0 flex-none disabled:opacity-60 ${
            props.isZoodleActive
              ? 'bg-ml-green text-chalkboard-100 hover:bg-ml-green'
              : 'bg-default'
          }`}
          aria-label="Zoodle"
        >
          <CustomIcon name="sketch" className="w-5 h-5" />
          <Tooltip position="top" hoverOnly={true}>
            <span>Zoodle</span>
          </Tooltip>
        </button>
      </div>
    </div>
  )
}

export const DummyContent = 'o|-<'

export type MlEphantManagerPromptContext =
  | {
      type: 'selections'
      data: Selections
    }
  | {
      type: 'dummy'
      data: typeof DummyContent
    }

export interface MlEphantContextsProps {
  contexts: MlEphantManagerPromptContext[]
}

const MlCopilotSelectionsContext = (props: {
  selections: Extract<MlEphantManagerPromptContext, { type: 'selections' }>
}) => {
  const { kclManager } = useSingletons()
  const selectionText = getSelectionTypeDisplayText(
    kclManager.astSignal.value,
    props.selections.data,
    kclManager.artifactGraph
  )
  return selectionText ? (
    <button className="group/tool h-7 bg-default flex-none flex flex-row items-center gap-1 m-0 pl-1 pr-2 rounded-sm">
      <CustomIcon name="clipboardCheckmark" className="w-6 h-6 block" />
      {selectionText}
    </button>
  ) : null
}

interface MlEphantConversationInputProps {
  contexts: MlEphantManagerPromptContext[]
  onProcess: MlEphantConversationProps['onProcess']
  onReconnect: MlEphantConversationProps['onReconnect']
  onCancel: MlEphantConversationProps['onCancel']
  hasPromptCompleted: MlEphantConversationProps['hasPromptCompleted']
  disabled?: boolean
  needsReconnect: boolean
  defaultPrompt?: string
  hasAlreadySentPrompts: boolean
  initialMlCopilotMode?: MlCopilotModeId
  onMlCopilotModeChange?: (mode: MlCopilotModeId | undefined) => void
  isProcessing: boolean
  queue: QueuedMessage[]
  onRemoveFromQueue: (id: string) => void
  modeOptions?: MlCopilotModeOption[]
  modeScopeKey?: string
}

export const MlEphantConversationInput = (
  props: MlEphantConversationInputProps
) => {
  const { registry } = useApp()
  const refDiv = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState<string>('')
  const [mode, setMode] = useState<MlCopilotModeId | undefined>(
    props.initialMlCopilotMode
  )
  const userHasPickedMode = useRef(false)
  const lastModeScopeKey = useRef(props.modeScopeKey)
  const [attachments, setAttachments] = useState<File[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isZoodleActive, setIsZoodleActive] = useState(false)

  const stopZoodleRuntimeExtension = useCallback(() => {
    setIsZoodleActive(false)
    deactivateZoodleRuntimeExtension(registry)
  }, [registry])

  useEffect(() => {
    return () => {
      stopZoodleRuntimeExtension()
    }
  }, [stopZoodleRuntimeExtension])

  // Without this the cursor ends up at the start of the text
  useEffect(() => setValue(props.defaultPrompt || ''), [props.defaultPrompt])

  // A user pick is local to the current project/chat scope. When that scope
  // changes, resume following the resolved setting/server default.
  useEffect(() => {
    if (lastModeScopeKey.current === props.modeScopeKey) return
    lastModeScopeKey.current = props.modeScopeKey
    userHasPickedMode.current = false
    setMode(props.initialMlCopilotMode)
  }, [props.modeScopeKey, props.initialMlCopilotMode])

  // Follow updates to the resolved initial mode (server defaultMode arriving)
  // until the user picks a mode themselves. After that,
  // preserve their choice across reconnects rather than clobbering it.
  useEffect(() => {
    if (userHasPickedMode.current) return
    setMode(props.initialMlCopilotMode)
  }, [props.initialMlCopilotMode])

  // Reconcile if the server's options change such that the current selection
  // is no longer offered — otherwise the dropdown would display one mode
  // while submission still sends another.
  const { modeOptions, onMlCopilotModeChange } = props
  useEffect(() => {
    if (!modeOptions || modeOptions.length === 0) return
    const currentMode = getModeOption(mode, modeOptions)
    if (currentMode?.disabled) {
      const fallbackMode = getFirstEnabledModeOption(modeOptions)?.id
      userHasPickedMode.current = false
      setMode(fallbackMode)
      onMlCopilotModeChange?.(fallbackMode)
      return
    }
    if (mode !== undefined && currentMode === undefined) {
      userHasPickedMode.current = false
      setMode(undefined)
      onMlCopilotModeChange?.(undefined)
    }
  }, [modeOptions, mode, onMlCopilotModeChange])

  const onClick = () => {
    if (props.disabled) return

    if (!value && attachments.length === 0) return
    if (!refDiv.current) return

    props.onProcess(value, getModeOption(mode, modeOptions)?.id, attachments)
    setValue('')
    setAttachments([])
  }

  const deduplicateFileName = (
    name: string,
    existingNames: string[]
  ): string => {
    if (!existingNames.includes(name)) return name
    const dotIndex = name.lastIndexOf('.')
    const base = dotIndex !== -1 ? name.slice(0, dotIndex) : name
    const ext = dotIndex !== -1 ? name.slice(dotIndex) : ''
    let i = 1
    while (existingNames.includes(`${base}-${i}${ext}`)) i++
    return `${base}-${i}${ext}`
  }

  const appendAttachments = (files: File[]) => {
    if (!files.length) return
    setAttachments((current) => {
      const next = [...current]
      for (const file of files) {
        const newName = deduplicateFileName(
          file.name,
          next.map((f) => f.name)
        )
        if (newName !== file.name) {
          next.push(
            new File([file], newName, {
              type: file.type,
              lastModified: file.lastModified,
            })
          )
        } else {
          next.push(file)
        }
      }
      return next
    })
  }

  const onAttachFiles = () => {
    if (props.disabled) return
    fileInputRef.current?.click()
  }

  const appendDataUrlAttachment = (dataUrl: string, fileName: string) => {
    const file = dataUrlToFile(dataUrl, fileName)
    if (err(file)) {
      console.error('Failed to create screenshot attachment', file)
      return
    }
    appendAttachments([file])
  }

  const onCaptureScreenshot = () => {
    if (props.disabled) return
    try {
      const dataUrl = takeViewportScreenshot()
      if (!dataUrl) return
      appendDataUrlAttachment(dataUrl, 'viewport-screenshot.png')
    } catch (e) {
      console.error('Failed to capture viewport screenshot', e)
    }
  }

  const onAnnotateScreenshot = () => {
    if (isZoodleActive) {
      stopZoodleRuntimeExtension()
      return
    }

    if (props.disabled) return
    try {
      const dataUrl = takeViewportScreenshot()
      if (!dataUrl) return
      setIsZoodleActive(true)
      activateZoodleRuntimeExtension(registry, {
        imageDataUrl: dataUrl,
        onCancel: stopZoodleRuntimeExtension,
        onSend: (annotatedDataUrl) => {
          appendDataUrlAttachment(
            annotatedDataUrl,
            'annotated-viewport-screenshot.png'
          )
          stopZoodleRuntimeExtension()
        },
      })
    } catch (e) {
      setIsZoodleActive(false)
      console.error('Failed to capture viewport screenshot for annotation', e)
    }
  }

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    appendAttachments(files)

    event.target.value = ''
  }

  const onRemoveAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, i) => i !== index))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (props.disabled) return
    if (isExternalFileDrag(e)) {
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set to false if we're leaving the container (not entering a child)
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDraggingOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    if (props.disabled) return

    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return

    appendAttachments(files)
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files)
    if (!files.length) return
    if (props.disabled) return

    // Prevent default only if we have files to handle
    e.preventDefault()

    appendAttachments(files)
  }

  const selectionsContext:
    | Extract<MlEphantManagerPromptContext, { type: 'selections' }>
    | undefined = props.contexts.filter((m) => m.type === 'selections')[0]

  return (
    <div className="flex flex-col p-4 gap-2">
      <div
        className={`p-2 border b-4 focus-within:b-default flex flex-col gap-2 relative ${isDraggingOver ? 'border-ml-green border-dashed' : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingOver && (
          <div className="absolute inset-0 bg-ml-green/10 flex items-center justify-center pointer-events-none z-10 rounded">
            <span className="text-sm text-ml-green font-medium">
              Drop files to attach
            </span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onFileInputChange}
          className="hidden"
        />
        <textarea
          {...noAutofillInputProps}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          data-testid="ml-ephant-conversation-input"
          onChange={(e) => setValue(e.target.value)}
          value={value}
          ref={refDiv}
          placeholder={
            props.isProcessing
              ? 'Type a follow-up to queue...'
              : props.hasAlreadySentPrompts
                ? ''
                : 'Create a gear with 10 teeth and use sensible defaults for everything else...'
          }
          onKeyDown={(e) => {
            const isOnlyEnter =
              e.key === 'Enter' && !(e.shiftKey || e.metaKey || e.ctrlKey)
            if (isOnlyEnter) {
              e.preventDefault()
              onClick()
            }
          }}
          onPaste={handlePaste}
          className="bg-transparent outline-none w-full text-sm overflow-auto"
          style={{ height: '3lh' }}
        ></textarea>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {attachments.map((file, index) => (
              <div
                key={`${file.name}-${file.lastModified}-${file.size}`}
                className="flex items-center gap-1 rounded bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-20 dark:border-chalkboard-80 px-2 py-1 text-xs"
                title={file.name}
              >
                <CustomIcon name="file" className="w-4 h-4" />
                <span className="max-w-[160px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(index)}
                  className="ml-1 text-chalkboard-70 hover:text-chalkboard-100 dark:hover:text-chalkboard-20"
                  aria-label={`Remove ${file.name}`}
                >
                  <CustomIcon name="close" className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1"
          data-testid="ml-ephant-composer-actions"
        >
          <MlEphantExtraInputs
            context={selectionsContext}
            mode={mode}
            onSetMode={(m) => {
              userHasPickedMode.current = true
              setMode(m)
              props.onMlCopilotModeChange?.(m)
            }}
            onAttachFiles={onAttachFiles}
            onCaptureScreenshot={onCaptureScreenshot}
            onAnnotateScreenshot={onAnnotateScreenshot}
            attachmentsDisabled={props.disabled}
            isZoodleActive={isZoodleActive}
            modeOptions={props.modeOptions}
          />
          <div className="flex flex-none flex-row gap-1">
            {!props.disabled && props.needsReconnect && (
              <div className="flex flex-col w-fit items-end">
                <div className="pr-1 text-xs text-red-500 flex flex-row items-center h-5">
                  <CustomIcon name="close" className="w-7 h-7" />{' '}
                  <span>Disconnected</span>
                </div>
                <button onClick={props.onReconnect}>Reconnect</button>
              </div>
            )}
            {props.isProcessing && (
              <button
                data-testid="ml-ephant-conversation-cancel-button"
                onClick={props.onCancel}
                className="m-0 p-1 rounded-sm border-none bg-destroy-10 text-destroy-80 dark:bg-destroy-80 dark:text-destroy-10 group-hover:brightness-110"
              >
                <CustomIcon name="close" className="w-5 h-5" />
                <Tooltip position="top" hoverOnly={true}>
                  <span>Cancel</span>
                </Tooltip>
              </button>
            )}
            <button
              data-testid="ml-ephant-conversation-input-button"
              disabled={props.disabled}
              onClick={onClick}
              className="m-0 p-1 rounded-sm border-none bg-ml-green hover:bg-ml-green text-chalkboard-100"
            >
              <CustomIcon name="arrowShortUp" className="w-5 h-5" />
              <Tooltip position="top" hoverOnly={true}>
                <span>{props.isProcessing ? 'Queue' : 'Send'}</span>
              </Tooltip>
            </button>
          </div>
        </div>
      </div>
      <div className="text-3 text-xs">
        Zookeeper can make mistakes. Always verify information.
      </div>
    </div>
  )
}

const StarterCard = ({ text }: { text: string }) => {
  const [, setTrigger] = useState<number>(0)

  useEffect(() => {
    const i = setInterval(() => {
      setTrigger((t) => t + 1)
    }, 500)
    return () => {
      clearInterval(i)
    }
  }, [])

  return (
    <ExchangeCard
      onClickClearChat={() => {}}
      isLastResponse={false}
      responses={[]}
      deltasAggregated={text}
    />
  )
}

export const MlEphantConversation = (props: MlEphantConversationProps) => {
  const refScroll = useRef<HTMLDivElement>(null)
  const exchangesLength = props.conversation?.exchanges.length ?? 0
  const hasMessages = exchangesLength > 0
  const lastExchange = exchangesLength
    ? props.conversation?.exchanges[exchangesLength - 1]
    : undefined
  const isEndOfStream = lastExchange?.responses.some(
    (ex) => 'end_of_stream' in ex || 'error' in ex || 'info' in ex
  )

  // Autoscroll: right after sending a prompt when the new exchange is added
  useEffect(() => {
    if (exchangesLength === 0 || !refScroll.current) return
    refScroll.current.scrollTo({
      top: refScroll.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [exchangesLength])

  // Autoscroll: right after Zookeeper completes its turn in the exchange.
  useEffect(() => {
    if (!isEndOfStream || !refScroll.current) return
    refScroll.current.scrollTo({
      top: refScroll.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [isEndOfStream])

  const exchangeCards = props.conversation?.exchanges.flatMap(
    (exchange: Exchange, exchangeIndex: number, list) => {
      const isLastResponse = exchangeIndex === list.length - 1
      return (
        <ExchangeCard
          key={`exchange-${exchangeIndex}`}
          {...exchange}
          userAvatar={props.userAvatarSrc}
          isLastResponse={isLastResponse}
          onClickClearChat={isLastResponse ? props.onClickClearChat : noop}
        />
      )
    }
  )
  const shouldShowWelcomeMessage = isNonNullable(props.welcomeMessage)

  return (
    <div className="relative">
      <div className="absolute inset-0">
        <div className="flex flex-col h-full">
          <div className="h-full flex flex-col justify-end overflow-auto relative">
            <div className="overflow-auto" ref={refScroll}>
              {props.blockedReason ? (
                <StarterCard text={props.blockedReason} />
              ) : props.isLoading === false &&
                props.needsReconnect === false ? (
                <>
                  {shouldShowWelcomeMessage && (
                    <div
                      data-testid="ml-ephant-conversation-welcome-section"
                      className={
                        hasMessages
                          ? 'border-b border-chalkboard-20 dark:border-chalkboard-80'
                          : undefined
                      }
                    >
                      {props.welcomeMessage}
                    </div>
                  )}
                  {hasMessages ? (
                    <>
                      {exchangeCards}
                      {lastExchange && !isEndOfStream && (
                        <div className="absolute z-10 bottom-0 h-[1px] bg-ml-green animate-shimmer w-full" />
                      )}
                    </>
                  ) : null}
                </>
              ) : (
                <div className="text-center p-4">
                  <Loading isDummy={true} className="!text-ml-green"></Loading>
                </div>
              )}
            </div>
          </div>
          {props.queue.length > 0 && (
            <div className="border-t b-4 px-4 py-2 flex flex-col gap-1">
              <span className="text-xs text-3">Queued</span>
              {props.queue.map((msg, index) => (
                <div
                  key={msg.id}
                  className="flex items-center gap-2 rounded bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-20 dark:border-chalkboard-80 px-2 py-0.5 text-xs"
                >
                  <span className="text-3 shrink-0">{index + 1}.</span>
                  <span className="truncate min-w-0 flex-1">{msg.text}</span>
                  {msg.attachments.length > 0 && (
                    <span className="text-3 shrink-0 flex items-center gap-0.5">
                      <CustomIcon name="paperclip" className="w-3 h-3" />
                      {msg.attachments.length}
                    </span>
                  )}
                  {getModeOption(msg.mode, props.modeOptions) ? (
                    <span className="text-3 shrink-0">
                      {getModeOption(msg.mode, props.modeOptions)?.label}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => props.onSteer(msg.id)}
                    className="shrink-0 flex gap-0.5 items-center pl-0.5 pr-2 py-0.5 m-0 rounded border border-chalkboard-30 dark:border-chalkboard-70 bg-transparent hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 text-xs"
                    aria-label={`Send queued message ${index + 1} now`}
                  >
                    <CustomIcon name="arrowShortUp" className="w-4 h-4" />
                    Steer
                    <Tooltip position="top" hoverOnly={true}>
                      <span>Interrupt and send this prompt</span>
                    </Tooltip>
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onRemoveFromQueue(msg.id)}
                    className="shrink-0 text-3 hover:text-chalkboard-100 dark:hover:text-chalkboard-20 p-1 m-0 border-none bg-transparent"
                    aria-label={`Remove queued message ${index + 1}`}
                  >
                    <CustomIcon name="close" className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="border-t b-4">
            <MlEphantConversationInput
              contexts={props.contexts}
              disabled={
                Boolean(props.blockedReason) ||
                props.disabled ||
                props.isLoading
              }
              hasPromptCompleted={props.hasPromptCompleted}
              needsReconnect={props.needsReconnect}
              onProcess={props.onProcess}
              initialMlCopilotMode={props.initialMlCopilotMode}
              onMlCopilotModeChange={props.onMlCopilotModeChange}
              onReconnect={props.onReconnect}
              onCancel={props.onCancel}
              defaultPrompt={props.defaultPrompt}
              hasAlreadySentPrompts={hasMessages}
              isProcessing={props.isProcessing}
              queue={props.queue}
              onRemoveFromQueue={props.onRemoveFromQueue}
              modeOptions={props.modeOptions}
              modeScopeKey={props.modeScopeKey}
            />
          </div>
        </div>
        {props.showMakeathonAnnouncement ? (
          <MakeathonAnnouncement
            presentation="dialog"
            className="w-[min(28rem,100%)]"
          />
        ) : null}
      </div>
    </div>
  )
}
