import type { MlCopilotServerMessage } from '@kittycad/lib'
import { MarkdownText } from '@src/components/MarkdownText'
import { PlaceholderLine } from '@src/components/PlaceholderLine'
import { Thinking } from '@src/components/Thinking'
import {
  type Exchange,
  isMlCopilotUserRequest,
} from '@src/lib/zookeeper/mlEphantManagerMachine'
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react'
import toast from 'react-hot-toast'

export type ExchangeCardProps = Exchange & {
  onClickClearChat: () => void
  isLastResponse: boolean
}

type MlCopilotServerMessageError = Extract<
  MlCopilotServerMessage,
  { error: unknown }
>

type MlCopilotServerMessageEndOfStream = Extract<
  MlCopilotServerMessage,
  { end_of_stream: unknown }
>

const NON_TERMINAL_INFO_TEXTS = [
  'Manual edits detected since the last Zookeeper state.',
  'Transient model streaming error; retrying.',
]

const getEndOfStreamResponse = (
  responses?: MlCopilotServerMessage[]
): MlCopilotServerMessageEndOfStream | undefined =>
  responses?.findLast(
    (response): response is MlCopilotServerMessageEndOfStream =>
      'end_of_stream' in response
  )

const isNonTerminalInfoResponse = (response: MlCopilotServerMessage): boolean =>
  'info' in response &&
  NON_TERMINAL_INFO_TEXTS.some((infoText) =>
    response.info.text.startsWith(infoText)
  )

const isExchangeComplete = (responses?: MlCopilotServerMessage[]): boolean =>
  responses?.some(
    (response) =>
      'end_of_stream' in response ||
      'error' in response ||
      ('info' in response && !isNonTerminalInfoResponse(response))
  ) ?? false

export interface IButtonCopyProps {
  content: string
}

export const ButtonCopy = (props: IButtonCopyProps) => (
  <button
    type="button"
    onClick={() => {
      if (!props.content) {
        return
      }
      navigator.clipboard.writeText(props.content).then(
        () => {
          toast.success('Copied response to clipboard.')
        },
        () => {
          toast.error('Failed to copy response to clipboard.')
        }
      )
    }}
    className="px-0 py-1 text-xs text-chalkboard-70 dark:text-chalkboard-40"
  >
    Copy
  </button>
)

export const ButtonClearChat = (props: ComponentProps<'button'>) => {
  const { className = '', ...buttonProps } = props

  return (
    <button
      {...buttonProps}
      className={`px-0 py-1 text-xs text-chalkboard-70 dark:text-chalkboard-40 ${className}`}
    >
      Clear chat
    </button>
  )
}

export const ResponseCardToolBar = (props: {
  responses?: MlCopilotServerMessage[]
  onClickClearChat: () => void
  isLastResponse: boolean
}) => {
  const isEndOfStream = isExchangeComplete(props.responses)

  let contentForClipboard: string | undefined = ''

  if (isEndOfStream) {
    contentForClipboard = getEndOfStreamResponse(props.responses)?.end_of_stream
      .whole_response
  }

  return (
    <div className="flex flex-row justify-between">
      {isEndOfStream ? (
        <ButtonCopy content={contentForClipboard ?? ''} />
      ) : (
        <div></div>
      )}
      {props.isLastResponse && (
        <ButtonClearChat onClick={props.onClickClearChat} />
      )}
    </div>
  )
}

export const ExchangeCardStatus = (props: {
  responses?: MlCopilotServerMessage[]
  onlyShowImmediateThought: boolean
  maybeError?: MlCopilotServerMessageError
}) => {
  const thinker = (
    <Thinking
      thoughts={props.responses}
      isDone={props.responses?.some((m) => 'delta' in m) || false}
      onlyShowImmediateThought={props.onlyShowImmediateThought}
    />
  )

  // Error and info also signals the end of a stream, because we'll never
  // see an end_of_stream from them.
  const isEndOfStream = isExchangeComplete(props.responses)

  return props.onlyShowImmediateThought ? (
    <div className="text-sm text-chalkboard-70">
      {isEndOfStream && <MaybeError />}
      {!isEndOfStream && thinker}
    </div>
  ) : (
    <div className="relative">{thinker}</div>
  )
}

type RequestCardProps = Exchange['request']

const MAX_VISIBLE_ATTACHMENTS = 2

const hasVisibleChildren = (children: ReactNode) => {
  return (
    (children instanceof Array && children.length > 0) ||
    (typeof children === 'string' && children !== '')
  )
}

export const ChatBubble = (props: {
  side: 'left' | 'right'
  wfull?: true
  children: ReactNode
  dataTestId?: string
  placeholderTestId?: string
  className?: string
}) => {
  const cssRequest = `${props.wfull ? 'w-full ' : ''}select-text whitespace-pre-line hyphens-auto text-default ${
    props.side === 'left'
      ? 'bg-transparent'
      : 'max-w-[85%] rounded-md bg-chalkboard-20 px-4 dark:bg-chalkboard-90'
  } ${props.className ?? ''}`

  return (
    <div
      className={`flex w-full ${props.side === 'right' ? 'justify-end' : 'justify-start'}`}
      data-testid={props.dataTestId}
    >
      <div style={{ wordBreak: 'break-word' }} className={cssRequest}>
        {hasVisibleChildren(props.children) ? (
          props.children
        ) : (
          <PlaceholderLine data-testid={props.placeholderTestId} />
        )}
      </div>
    </div>
  )
}

export const RequestCard = (props: RequestCardProps) => {
  const [showAllAttachments, setShowAllAttachments] = useState(false)

  if (!isMlCopilotUserRequest(props)) {
    return null
  }

  const additionalFiles = props.additional_files ?? []
  const hasHiddenAttachments = additionalFiles.length > MAX_VISIBLE_ATTACHMENTS
  const visibleAttachments = showAllAttachments
    ? additionalFiles
    : additionalFiles.slice(0, MAX_VISIBLE_ATTACHMENTS)

  return (
    <>
      <ChatBubble
        side={'right'}
        dataTestId="ml-request-chat-bubble"
        className="pt-2 pb-2"
      >
        {props.content}
      </ChatBubble>
      {additionalFiles.length > 0 && (
        <div className="flex justify-end">
          <div
            className="flex flex-col items-end gap-1"
            data-testid="ml-request-chat-bubble-attachments"
          >
            <div className="w-full text-right text-xs font-medium text-chalkboard-70 dark:text-chalkboard-40">
              Attachments
            </div>
            {visibleAttachments.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-1 rounded-sm border border-chalkboard-30 dark:border-chalkboard-70 px-2 py-1 text-xs"
              >
                <span className="min-w-0 truncate">{file.name}</span>
              </div>
            ))}
            {hasHiddenAttachments && (
              <button
                type="button"
                onClick={() => setShowAllAttachments(!showAllAttachments)}
                className="pt-1 pb-1 text-xs"
                aria-expanded={showAllAttachments}
              >
                {showAllAttachments ? '- collapse' : '+ more'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export const Delta = (props: { children: ReactNode }) => {
  return (
    <span className="animate-delta-in" style={{ opacity: 0 }}>
      {props.children}
    </span>
  )
}

type ResponsesCardProp = {
  items: Exchange['responses']
  deltasAggregated: Exchange['deltasAggregated']
  isLastResponse: boolean
  onClickClearChat: () => void
}

const MaybeError = (props: { maybeError?: MlCopilotServerMessageError }) =>
  props.maybeError ? (
    <div className="text-rose-400">
      <MarkdownText text={props.maybeError?.error.detail} />
    </div>
  ) : null

// This can be used to show `delta` or `tool_output`
export const ResponsesCard = (props: ResponsesCardProp) => {
  const infoItems = props.items.map(
    (response: MlCopilotServerMessage, index: number) => {
      // This is INTENTIONALLY left here for documentation.
      // We aggregate `delta` responses into `Exchange.responseAggregated`
      // as an optimization. Originally we'd have 1000s of React components,
      // causing problems like slowness and exceeding stack depth.
      // if ('delta' in response) {
      //   return response.delta.delta
      // }
      if ('info' in response) {
        return <Delta key={index}>{response.info.text}</Delta>
      }
      return null
    }
  )

  const infoItemsFilteredNulls = infoItems.filter(
    (x: ReactNode | null) => x !== null
  )

  const maybeError = props.items.filter((r) => 'error' in r)[0]
  const isComplete = isExchangeComplete(props.items)

  const deltasAggregatedMarkdown = useMemo(() => {
    return props.deltasAggregated !== '' ? (
      <MarkdownText
        key="response"
        text={props.deltasAggregated}
        className="whitespace-normal"
      />
    ) : null
  }, [props.deltasAggregated])

  const children = [
    maybeError ? <MaybeError key="error" maybeError={maybeError} /> : null,
    deltasAggregatedMarkdown,
  ].filter((x: ReactNode) => x !== null)

  const shouldShowResponseBubble =
    hasVisibleChildren(children) || (props.isLastResponse && !isComplete)

  return infoItemsFilteredNulls.length > 0 || shouldShowResponseBubble ? (
    <>
      {infoItemsFilteredNulls.length > 0 && (
        <ChatBubble
          side={'left'}
          wfull={true}
          dataTestId="ml-response-info-chat-bubble"
          className="py-4"
        >
          {infoItemsFilteredNulls}
        </ChatBubble>
      )}
      {shouldShowResponseBubble && (
        <ChatBubble
          side={'left'}
          wfull={true}
          dataTestId="ml-response-chat-bubble"
          placeholderTestId="ml-response-chat-bubble-thinking"
          className="py-4"
        >
          {children}
        </ChatBubble>
      )}
      <ResponseCardToolBar
        responses={props.items}
        isLastResponse={props.isLastResponse}
        onClickClearChat={props.onClickClearChat}
      />
    </>
  ) : null
}

export const ExchangeCard = (props: ExchangeCardProps) => {
  const [showFullReasoning, setShowFullReasoning] = useState<boolean>(true)

  const cssCard = `flex flex-col px-4 py-2 gap-2 justify-between
    transition-height duration-500 overflow-hidden text-sm
  `

  const onSeeReasoning = () => {
    setShowFullReasoning(!showFullReasoning)
  }

  const isEndOfStream = isExchangeComplete(props.responses)

  useEffect(() => {
    if (isEndOfStream) {
      setShowFullReasoning(false)
    }
  }, [isEndOfStream])

  const maybeError = props.responses.filter((r) => 'error' in r)[0]

  const reasoningThoughts = props.responses.filter((r) => 'reasoning' in r)

  return (
    <div className={cssCard}>
      {isMlCopilotUserRequest(props.request) && (
        <RequestCard {...props.request} />
      )}
      {showFullReasoning && reasoningThoughts.length > 0 && (
        <div>
          <ExchangeCardStatus
            responses={props.responses}
            onlyShowImmediateThought={false}
          />
        </div>
      )}
      {reasoningThoughts.length > 0 && (
        <div
          tabIndex={0}
          role="button"
          className="pl-8 flex flex-row items-center cursor-pointer justify-start gap-2"
          onClick={() => onSeeReasoning()}
        >
          <div>
            <button className="flex justify-center items-center flex-none pt-1 pb-1">
              {showFullReasoning ? 'Collapse' : 'See reasoning'}
            </button>
          </div>
          {props.isLastResponse && (
            <ExchangeCardStatus
              maybeError={maybeError}
              responses={props.responses}
              onlyShowImmediateThought={true}
            />
          )}
        </div>
      )}
      <ResponsesCard
        items={props.responses}
        deltasAggregated={props.deltasAggregated}
        isLastResponse={props.isLastResponse}
        onClickClearChat={props.onClickClearChat}
      />
    </div>
  )
}
