import { getSelectionTypeDisplayText } from '@src/lib/selections'
import Loading from '@src/components/Loading'
import { type Selections } from '@src/machines/modelingSharedTypes'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { MlCopilotMode } from '@kittycad/lib'
import { Popover } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ExchangeCard } from '@src/components/ExchangeCard'
import type {
  Conversation,
  Exchange,
} from '@src/machines/mlEphantManagerMachine'
import type { ChangeEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_ML_COPILOT_MODE } from '@src/lib/constants'
import { useSingletons } from '@src/lib/boot'
import Tooltip from '@src/components/Tooltip'
import toast from 'react-hot-toast'

const noop = () => {}

const ATTACHMENT_ACCEPT =
  'application/pdf,text/markdown,text/x-markdown,.md,.markdown,image/*'
const ATTACHMENT_EXTENSIONS = new Set([
  '.pdf',
  '.md',
  '.markdown',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.svg',
])

const isSupportedAttachment = (file: File): boolean => {
  if (file.type.startsWith('image/')) return true
  if (file.type === 'application/pdf') return true
  if (file.type === 'text/markdown' || file.type === 'text/x-markdown')
    return true

  return isSupportedAttachmentName(file.name)
}

const isSupportedAttachmentName = (name: string): boolean => {
  const lower = name.toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  if (dotIndex === -1) return false
  return ATTACHMENT_EXTENSIONS.has(lower.slice(dotIndex))
}

const resolveAttachmentMimeType = (name: string): string => {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.md') || lower.endsWith('.markdown'))
    return 'text/markdown'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

export interface MlEphantConversationProps {
  isLoading: boolean
  conversation?: Conversation
  contexts: MlEphantManagerPromptContext[]
  onProcess: (request: string, mode: MlCopilotMode, attachments: File[]) => void
  onCancel: () => void
  onClickClearChat: () => void
  onReconnect: () => void
  disabled?: boolean
  needsReconnect: boolean
  hasPromptCompleted: boolean
  userAvatarSrc?: string
  userBlockedOnPayment?: boolean
  defaultPrompt?: string
}

const ML_COPILOT_MODE_META = Object.freeze({
  fast: {
    pretty: 'Fast',
    icon: (props: { className: string }) => (
      <CustomIcon name="stopwatch" className={props.className} />
    ),
  },
  thoughtful: {
    pretty: 'Thoughtful',
    icon: (props: { className: string }) => (
      <CustomIcon name="brain" className={props.className} />
    ),
  },
} as const)

const ML_COPILOT_MODE: Readonly<MlCopilotMode[]> = Object.freeze([
  'fast',
  'thoughtful',
])

export interface MlCopilotModesProps {
  onClick: (mode: MlCopilotMode) => void
  children: ReactNode
  current: MlCopilotMode
}

const MlCopilotModes = (props: MlCopilotModesProps) => {
  return (
    <>
      <Popover className="relative">
        <Popover.Button
          data-testid="ml-copilot-efforts-button"
          className="h-7 bg-default flex flex-row items-center gap-1 m-0 pl-1 pr-2 rounded-sm"
        >
          {props.children}
          <CustomIcon name="caretUp" className="w-5 h-5 ui-open:rotate-180" />
        </Popover.Button>

        <Popover.Panel className="absolute bottom-full left-0 flex flex-col gap-2 bg-default mb-1 p-2 border border-chalkboard-70 text-xs rounded-md">
          {({ close }) => (
            <>
              {' '}
              {ML_COPILOT_MODE.map((mode) => (
                <div
                  tabIndex={0}
                  role="button"
                  key={mode}
                  onClick={() => {
                    close()
                    props.onClick(mode)
                  }}
                  className={`flex flex-row items-center text-nowrap gap-2 cursor-pointer hover:bg-3 p-2 pr-4 rounded-md border ${props.current === mode ? 'border-primary' : ''}`}
                  data-testid={`ml-copilot-effort-button-${mode}`}
                >
                  {ML_COPILOT_MODE_META[mode].icon({ className: 'w-5 h-5' })}
                  {ML_COPILOT_MODE_META[mode].pretty}
                </div>
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
  mode: MlCopilotMode
  onSetMode: (mode: MlCopilotMode) => void
  onAttachFiles: () => void
  attachmentsDisabled?: boolean
}

export const MlEphantExtraInputs = (props: MlEphantExtraInputsProps) => {
  return (
    <div className="flex-1 flex min-w-0 items-end">
      <div className="flex flex-row w-fit-content items-end gap-1">
        {/* TODO: Generalize to a MlCopilotContexts component */}
        {props.context && (
          <MlCopilotSelectionsContext selections={props.context} />
        )}
        <MlCopilotModes onClick={props.onSetMode} current={props.mode}>
          {ML_COPILOT_MODE_META[props.mode].icon({
            className: 'w-5 h-5',
          })}
          {ML_COPILOT_MODE_META[props.mode].pretty}
        </MlCopilotModes>
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
    props.selections.data
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
}

export const MlEphantConversationInput = (
  props: MlEphantConversationInputProps
) => {
  const refDiv = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState<string>('')
  const [mode, setMode] = useState<MlCopilotMode>(DEFAULT_ML_COPILOT_MODE)
  const [attachments, setAttachments] = useState<File[]>([])

  // Without this the cursor ends up at the start of the text
  useEffect(() => setValue(props.defaultPrompt || ''), [props.defaultPrompt])

  const onClick = () => {
    if (props.disabled) return

    if (!value) return
    if (!refDiv.current) return

    props.onProcess(value, mode, attachments)
    setValue('')
    setAttachments([])
  }

  const appendAttachments = (files: File[]) => {
    if (!files.length) return
    setAttachments((current) => {
      const next = [...current]
      for (const file of files) {
        const exists = next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            (existing.lastModified === file.lastModified ||
              existing.lastModified === 0 ||
              file.lastModified === 0)
        )
        if (!exists) {
          next.push(file)
        }
      }
      return next
    })
  }

  const onAttachFiles = async () => {
    if (props.disabled) return

    if (window.electron?.open) {
      try {
        const result = await window.electron!.open({
          properties: ['openFile', 'multiSelections'],
          title: 'Attach files',
          filters: [
            {
              name: 'Supported files',
              extensions: Array.from(ATTACHMENT_EXTENSIONS).map((ext) =>
                ext.replace('.', '')
              ),
            },
          ],
        })

        if (result.canceled) return

        const selectedPaths = result.filePaths ?? []
        const supportedPaths = selectedPaths.filter(isSupportedAttachmentName)
        if (supportedPaths.length !== selectedPaths.length) {
          toast.error('Only PDF, Markdown, and image files are supported.')
        }

        const files = await Promise.all(
          supportedPaths.map(async (filePath) => {
            try {
              const [data, stats] = await Promise.all([
                window.electron!.readFile(filePath),
                window.electron!.stat(filePath),
              ])
              const name = window.electron!.path.basename(filePath)
              const lastModified =
                typeof stats?.mtimeMs === 'number'
                  ? Math.round(stats.mtimeMs)
                  : Date.now()
              return new File([data], name, {
                type: resolveAttachmentMimeType(name),
                lastModified,
              })
            } catch (error) {
              console.warn('Failed to read attachment file', error)
              return null
            }
          })
        )

        const validFiles = files.filter((file): file is File => file !== null)
        if (validFiles.length !== supportedPaths.length) {
          toast.error('Some files could not be read.')
        }
        appendAttachments(validFiles)
        return
      } catch (error) {
        console.warn('Failed to open attachment dialog', error)
        toast.error('Unable to open file picker.')
        return
      }
    }

    fileInputRef.current?.click()
  }

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    const supported = files.filter(isSupportedAttachment)
    if (supported.length !== files.length) {
      toast.error('Only PDF, Markdown, and image files are supported.')
    }
    appendAttachments(supported)

    event.target.value = ''
  }

  const onRemoveAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, i) => i !== index))
  }

  const selectionsContext:
    | Extract<MlEphantManagerPromptContext, { type: 'selections' }>
    | undefined = props.contexts.filter((m) => m.type === 'selections')[0]

  return (
    <div className="flex flex-col p-4 gap-2">
      <div className="p-2 border b-4 focus-within:b-default flex flex-col gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={onFileInputChange}
          className="hidden"
        />
        <textarea
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          data-testid="ml-ephant-conversation-input"
          onChange={(e) => setValue(e.target.value)}
          value={value}
          ref={refDiv}
          placeholder={
            props.hasAlreadySentPrompts
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
        {}
        <div className="flex items-end">
          <MlEphantExtraInputs
            context={selectionsContext}
            mode={mode}
            onSetMode={setMode}
            onAttachFiles={onAttachFiles}
            attachmentsDisabled={props.disabled}
          />
          <div className="flex flex-row gap-1">
            {!props.disabled && props.needsReconnect && (
              <div className="flex flex-col w-fit items-end">
                <div className="pr-1 text-xs text-red-500 flex flex-row items-center h-5">
                  <CustomIcon name="close" className="w-7 h-7" />{' '}
                  <span>Disconnected</span>
                </div>
                <button onClick={props.onReconnect}>Reconnect</button>
              </div>
            )}
            {props.hasPromptCompleted ? (
              <button
                data-testid="ml-ephant-conversation-input-button"
                disabled={props.disabled}
                onClick={onClick}
                className="m-0 p-1 rounded-sm border-none bg-ml-green hover:bg-ml-green text-chalkboard-100"
              >
                <CustomIcon name="arrowShortUp" className="w-5 h-5" />
                <Tooltip position="top" hoverOnly={true}>
                  <span>Send</span>
                </Tooltip>
              </button>
            ) : (
              <button
                data-testid="ml-ephant-conversation-input-button"
                onClick={props.onCancel}
                className="m-0 p-1 rounded-sm border-none bg-destroy-10 text-destroy-80 dark:bg-destroy-80 dark:text-destroy-10 group-hover:brightness-110"
              >
                <CustomIcon name="close" className="w-5 h-5" />
                <Tooltip position="top" hoverOnly={true}>
                  <span>Cancel</span>
                </Tooltip>
              </button>
            )}
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
  const lastExchange = exchangesLength
    ? props.conversation?.exchanges[exchangesLength - 1]
    : undefined
  const isEndOfStream = lastExchange?.responses.some(
    (ex) => 'end_of_stream' in ex || 'error' in ex || 'info' in ex
  )

  // Autoscroll: right after sending a prompt when the new exchange is added
  useEffect(() => {
    if (exchangesLength === 0) return

    requestAnimationFrame(() => {
      if (refScroll.current) {
        refScroll.current.scrollTo({
          top: refScroll.current.scrollHeight,
          behavior: 'smooth',
        })
      }
    })
  }, [exchangesLength])

  // Autoscroll: right after Zookeeper completes its turn in the exchange.
  useEffect(() => {
    if (isEndOfStream) {
      requestAnimationFrame(() => {
        if (refScroll.current) {
          refScroll.current.scrollTo({
            top: refScroll.current.scrollHeight,
            behavior: 'smooth',
          })
        }
      })
    }
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

  return (
    <div className="relative">
      <div className="absolute inset-0">
        <div className="flex flex-col h-full">
          <div className="h-full flex flex-col justify-end overflow-auto relative">
            <div className="overflow-auto" ref={refScroll}>
              {props.userBlockedOnPayment ? (
                <StarterCard
                  text={`Zookeeper is unavailable because your remaining reasoning time is zero. Please check your [account page](${withSiteBaseURL('/account/billing')}) to view usage or upgrade your plan.`}
                />
              ) : props.isLoading === false || props.needsReconnect ? (
                exchangeCards !== undefined && exchangeCards.length > 0 ? (
                  <>
                    {exchangeCards}
                    {lastExchange && !isEndOfStream && (
                      <div className="absolute z-10 bottom-0 h-[1px] bg-ml-green animate-shimmer w-full" />
                    )}
                  </>
                ) : (
                  <StarterCard text="Try requesting a model, ask engineering questions, or let's explore ideas." />
                )
              ) : (
                <div className="text-center p-4">
                  <Loading isDummy={true} className="!text-ml-green"></Loading>
                </div>
              )}
            </div>
          </div>
          <div className="border-t b-4">
            <MlEphantConversationInput
              contexts={props.contexts}
              disabled={
                props.userBlockedOnPayment || props.disabled || props.isLoading
              }
              hasPromptCompleted={props.hasPromptCompleted}
              needsReconnect={props.needsReconnect}
              onProcess={props.onProcess}
              onReconnect={props.onReconnect}
              onCancel={props.onCancel}
              defaultPrompt={props.defaultPrompt}
              hasAlreadySentPrompts={
                exchangeCards !== undefined && exchangeCards.length > 0
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
