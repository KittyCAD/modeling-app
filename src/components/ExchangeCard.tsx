import type { MlCopilotServerMessage } from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { Thinking } from '@src/components/Thinking'
import {
  type Exchange,
  isMlCopilotUserRequest,
} from '@src/machines/mlEphantManagerMachine2'
import ms from 'ms'
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from 'react'
import Tooltip from '@src/components/Tooltip'
import toast from 'react-hot-toast'
import { PlaceholderLine } from '@src/components/PlaceholderLine'
import { SafeRenderer } from '@src/lib/markdown'
import { Marked, escape } from '@ts-stack/markdown'

export type ExchangeCardProps = Exchange & {
  userAvatar?: string
  onClickClearChat: () => void
  isLastResponse: boolean
}

type MlCopilotServerMessageError<T = MlCopilotServerMessage> = T extends {
  error: any
}
  ? T
  : never

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
          toast.success('Copied response to clipboard')
        },
        () => {
          toast.error('Failed to copy response to clipboard')
        }
      )
    }}
    className="pt-1 pb-1"
  >
    <CustomIcon name="clipboard" className="w-4 h-4" />
    <Tooltip
      position="right"
      hoverOnly={true}
      contentClassName="text-sm max-w-none flex items-center gap-5"
    >
      <span>Copy to clipboard</span>
    </Tooltip>
  </button>
)

export const ButtonClearChat = (props: ComponentProps<'button'>) => (
  <button {...props} className="pt-1 pb-1">
    <span className="flex flex-row gap-1">
      <CustomIcon name="trash" className="w-4 h-4" />
      <span>Clear chat</span>
    </span>
  </button>
)

export const ResponseCardToolBar = (props: {
  responses?: MlCopilotServerMessage[]
  onClickClearChat: () => void
  isLastResponse: boolean
}) => {
  const isEndOfStream =
    'end_of_stream' in (props.responses?.slice(-1)[0] ?? {}) ||
    props.responses?.some((x) => 'error' in x || 'info' in x)

  let contentForClipboard: string | undefined = ''

  if (isEndOfStream) {
    const lastResponse = props.responses?.slice(-1)[0]
    if (lastResponse !== undefined && 'end_of_stream' in lastResponse) {
      contentForClipboard = lastResponse.end_of_stream.whole_response
    }
  }

  return (
    <div className="pl-9 flex flex-row justify-between">
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
  startedAt: Date
  updatedAt?: Date
  maybeError?: MlCopilotServerMessageError
}) => {
  const [triggerRender, setTriggerRender] = useState<number>(0)
  const thinker = (
    <Thinking
      thoughts={props.responses}
      isDone={props.responses?.some((m) => 'delta' in m) || false}
      onlyShowImmediateThought={props.onlyShowImmediateThought}
    />
  )

  // Error and info also signals the end of a stream, because we'll never
  // see an end_of_stream from them.
  const isEndOfStream =
    'end_of_stream' in (props.responses?.slice(-1)[0] ?? {}) ||
    props.responses?.some((x) => 'error' in x || 'info' in x)

  useEffect(() => {
    const i = setInterval(() => {
      setTriggerRender(triggerRender + 1)
    }, 500)

    if (isEndOfStream) {
      clearInterval(i)
    }

    return () => {
      clearInterval(i)
    }
  }, [triggerRender, isEndOfStream])

  let timeReasonedFor = 0
  if (isEndOfStream) {
    const lastResponse = props.responses?.slice(-1)[0]
    if (lastResponse !== undefined && 'end_of_stream' in lastResponse) {
      timeReasonedFor =
        new Date(lastResponse.end_of_stream.completed_at ?? 0).getTime() -
        new Date(lastResponse.end_of_stream.started_at ?? 0).getTime()
    }
  } else {
    timeReasonedFor =
      (props.updatedAt ?? new Date()).getTime() - props.startedAt.getTime()
  }

  return props.onlyShowImmediateThought ? (
    <div className="text-sm text-chalkboard-70">
      {isEndOfStream && <MaybeError />}
      {!isEndOfStream && thinker}
    </div>
  ) : (
    <div className="relative">
      {thinker}
      {props.updatedAt && (
        <div className="text-chalkboard-70 p-2 pb-0">
          {timeReasonedFor ? (
            <>Reasoned for {ms(timeReasonedFor, { long: true })}</>
          ) : null}
        </div>
      )}
    </div>
  )
}

export const AvatarUser = (props: { src?: string }) => {
  return (
    <div className="avatar h-7 w-7">
      {props.src ? (
        <img
          src={props.src || ''}
          className="h-7 w-7 rounded-sm"
          referrerPolicy="no-referrer"
          alt="user avatar"
        />
      ) : (
        <CustomIcon
          name="person"
          className="w-7 h-7 text-chalkboard-70 dark:text-chalkboard-40 bg-chalkboard-20 dark:bg-chalkboard-80"
        />
      )}
    </div>
  )
}

type RequestCardProps = Exchange['request'] & {
  userAvatar?: ReactNode
}

const hasVisibleChildren = (children: ReactNode) => {
  return (
    (children instanceof Array && children.length > 0) ||
    (typeof children === 'string' && children !== '')
  )
}

export const ChatBubble = (props: {
  side: 'left' | 'right'
  userAvatar?: ReactNode
  wfull?: true
  children: ReactNode
  dataTestId?: string
  placeholderTestId?: string
  className?: string
}) => {
  const cssRequest =
    `${props.wfull ? 'w-full ' : ''} select-text whitespace-pre-line hyphens-auto shadow-sm ${props.side === 'left' ? '' : 'border b-4'} bg-2 text-default rounded-t-md pl-4 pr-4 ${props.className} ` +
    (props.side === 'left' ? 'rounded-br-md' : 'rounded-bl-md')

  return (
    <div
      className={`flex justify-end items-end gap-2 w-full ${props.side === 'right' ? 'flex-row' : 'flex-row-reverse'}`}
      data-testid={props.dataTestId}
    >
      <div className="flex flex-col items-end gap-2 w-full">
        <div style={{ wordBreak: 'break-word' }} className={cssRequest}>
          {hasVisibleChildren(props.children) ? (
            props.children
          ) : (
            <div className="pb-4">
              <PlaceholderLine data-testid={props.placeholderTestId} />
            </div>
          )}
        </div>
      </div>
      <div className="w-fit-content">{props.userAvatar}</div>
    </div>
  )
}

export const RequestCard = (props: RequestCardProps) => {
  if (!isMlCopilotUserRequest(props)) {
    return null
  }

  return (
    <ChatBubble
      side={'right'}
      userAvatar={props.userAvatar}
      dataTestId="ml-request-chat-bubble"
      className="pt-2 pb-2"
    >
      {props.content}
    </ChatBubble>
  )
}

export const Delta = (props: { children: ReactNode }) => {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (ref.current === null) return
    ref.current.scrollIntoView()
  }, [])

  return (
    <span className="animate-delta-in" style={{ opacity: 0 }}>
      {props.children}
      <span ref={ref}></span>
    </span>
  )
}

type ResponsesCardProp = {
  items: Exchange['responses']
  deltasAggregated: Exchange['deltasAggregated']
}

const MarkedOptions = {
  gfm: true,
  breaks: true,
  sanitize: true,
  escape,
}

const MaybeError = (props: { maybeError?: MlCopilotServerMessageError }) =>
  props.maybeError ? (
    <div className="text-rose-400 flex flex-row gap-1 items-start">
      <CustomIcon
        name="triangleExclamation"
        className="w-4 h-4 inline valign"
      />
      <span
        className="parsed-markdown"
        dangerouslySetInnerHTML={{
          __html: Marked.parse(props.maybeError?.error.detail, {
            renderer: new SafeRenderer(MarkedOptions),
            ...MarkedOptions,
          }),
        }}
      ></span>
    </div>
  ) : null

// This can be used to show `delta` or `tool_output`
export const ResponsesCard = (props: ResponsesCardProp) => {
  const items = props.items.map(
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
      if ('error' in response) {
        return <MaybeError key={index} maybeError={response} />
      }
      return null
    }
  )

  const itemsFilteredNulls = items.filter((x: ReactNode | null) => x !== null)

  const deltasAggregatedMarkdown =
    props.deltasAggregated !== '' ? (
      <span
        className="parsed-markdown"
        dangerouslySetInnerHTML={{
          __html: Marked.parse(props.deltasAggregated, {
            renderer: new SafeRenderer(MarkedOptions),
            ...MarkedOptions,
          }),
        }}
      ></span>
    ) : null

  return (
    <ChatBubble
      side={'left'}
      wfull={true}
      userAvatar={<div className="h-7 w-7 avatar bg-img-mel" />}
      dataTestId="ml-response-chat-bubble"
      placeholderTestId="ml-response-chat-bubble-thinking"
      className="pt-4"
    >
      {[
        itemsFilteredNulls.length > 0 ? itemsFilteredNulls : null,
        deltasAggregatedMarkdown,
      ].filter((x: ReactNode) => x !== null)}
    </ChatBubble>
  )
}

export const ExchangeCard = (props: ExchangeCardProps) => {
  let [startedAt] = useState<Date>(new Date())
  const [updatedAt, setUpdatedAt] = useState<Date | undefined>(undefined)

  const [showFullReasoning, setShowFullReasoning] = useState<boolean>(true)

  const cssCard = `flex flex-col p-2 gap-2 justify-between
    transition-height duration-500 overflow-hidden text-sm
  `

  const onSeeReasoning = () => {
    setShowFullReasoning(!showFullReasoning)
  }

  useEffect(() => {
    setUpdatedAt(new Date())
  }, [props.responses.length])

  const isEndOfStream =
    'end_of_stream' in (props.responses?.slice(-1)[0] ?? {}) ||
    props.responses?.some((x) => 'error' in x || 'info' in x)

  useEffect(() => {
    const id = setInterval(() => {
      if (isEndOfStream) {
        clearInterval(id)
      }
      setUpdatedAt(new Date())
    }, 1000)
    return () => {
      clearInterval(id)
    }
  }, [isEndOfStream])

  if (isEndOfStream) {
    const lastResponse = props.responses?.slice(-1)[0]
    if (lastResponse !== undefined && 'end_of_stream' in lastResponse) {
      startedAt = new Date(lastResponse.end_of_stream.started_at ?? 0)
    }
  }

  useEffect(() => {
    if (isEndOfStream) {
      setShowFullReasoning(false)
    }
  }, [isEndOfStream])

  const maybeError = props.responses.filter((r) => 'error' in r)[0]

  const reasoningThoughts = props.responses.filter((r) => 'reasoning' in r)

  return (
    <div className={cssCard}>
      <div className="p-7 text-chalkboard-70 text-center">
        {ms(Date.now() - startedAt.getTime(), { long: true })} ago
      </div>
      {isMlCopilotUserRequest(props.request) && (
        <RequestCard
          {...props.request}
          userAvatar={<AvatarUser src={props.userAvatar} />}
        />
      )}
      {showFullReasoning && reasoningThoughts.length > 0 && (
        <div>
          <ExchangeCardStatus
            responses={props.responses}
            onlyShowImmediateThought={false}
            startedAt={startedAt}
            updatedAt={updatedAt}
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
              {showFullReasoning ? (
                <>
                  Collapse <CustomIcon name="collapse" className="w-5 h-5" />
                </>
              ) : (
                <>See reasoning</>
              )}
            </button>
          </div>
          <ExchangeCardStatus
            maybeError={maybeError}
            responses={props.responses}
            onlyShowImmediateThought={true}
            startedAt={startedAt}
            updatedAt={updatedAt}
          />
        </div>
      )}
      <ResponsesCard
        items={props.responses}
        deltasAggregated={props.deltasAggregated}
      />
      <ResponseCardToolBar
        responses={props.responses}
        isLastResponse={props.isLastResponse}
        onClickClearChat={props.onClickClearChat}
      />
    </div>
  )
}
