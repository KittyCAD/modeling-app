import type {
  MlCopilotServerMessage,
  MlCopilotClientMessage,
} from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { Thinking } from '@src/components/Thinking'
import { type Exchange } from '@src/machines/mlEphantManagerMachine2'
import ms from 'ms'
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'

export type ExchangeCardProps = Exchange & {
  userAvatar?: string
}

type MlCopilotServerMessageError<T = MlCopilotServerMessage> = T extends {
  error: any
}
  ? T
  : never

export const ExchangeCardStatus = (props: {
  responses?: MlCopilotServerMessage[]
  onlyShowImmediateThought: boolean
  startedAt: Date
  updatedAt?: Date
  maybeError?: MlCopilotServerMessageError
}) => {
  const thinker = (
    <Thinking
      thoughts={props.responses}
      onlyShowImmediateThought={props.onlyShowImmediateThought}
    />
  )

  // Error and info also signals the end of a stream, because we'll never
  // see an end_of_stream from them.
  const isEndOfStream = 
    'end_of_stream' in (props.responses?.slice(-1)[0] ?? {})
    || props.responses?.some((x) => 'error' in x || 'info' in x)

  return props.onlyShowImmediateThought ? (
    <div className="text-sm text-chalkboard-70">
      {isEndOfStream && <MaybeError />}
      {!isEndOfStream && thinker}
    </div>
  ) : (
    <div>
      {thinker}
      {props.updatedAt && (
        <div className="text-chalkboard-70 p-2 pb-0">
          Reasoned for{' '}
          {ms(props.updatedAt.getTime() - props.startedAt.getTime(), {
            long: true,
          })}
        </div>
      )}
    </div>
  )
}

export const AvatarUser = (props: { src?: string }) => {
  return (
    <div className="rounded-full border overflow-hidden">
      {props.src ? (
        <img
          src={props.src || ''}
          className="h-7 w-7 rounded-full"
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

type MlCopilotClientMessageUser<T = MlCopilotClientMessage> = T extends {
  type: 'user'
}
  ? T
  : never

function isMlCopilotUserRequest(x: unknown): x is MlCopilotClientMessageUser {
  return typeof x === 'object' && x !== null && 'type' in x && x.type === 'user'
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
}) => {
  const cssRequest =
    `${props.wfull ? 'w-full ' : ''} select-text whitespace-pre-line hyphens-auto shadow-sm ${props.side === 'left' ? 'bg-1' : 'bg-2'} text-default border b-4 rounded-t-md pl-4 pr-4 pt-2 pb-2 ` +
    (props.side === 'left' ? 'rounded-br-md' : 'rounded-bl-md')

  return (
    <div
      className={`flex justify-end items-end gap-2 w-full ${props.side === 'right' ? 'flex-row' : 'flex-row-reverse'}`}
    >
      <div className="flex flex-col items-end gap-2 w-full">
        <div style={{ wordBreak: 'break-word' }} className={cssRequest}>
          {hasVisibleChildren(props.children) ? (
            props.children
          ) : (
            <div className="animate-pulse animate-shimmer h-4 w-full p-1 bg-chalkboard-80 rounded"></div>
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
    <ChatBubble side={'right'} userAvatar={props.userAvatar}>
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
}

const MaybeError = (props: { maybeError?: MlCopilotServerMessageError }) =>
  props.maybeError ? (
    <div className="text-rose-400">
      <CustomIcon
        name="triangleExclamation"
        className="w-4 h-4 inline valign"
      />{' '}
      {props.maybeError?.error.detail}
    </div>
  ) : null

// This can be used to show `delta` or `tool_output`
export const ResponsesCard = forwardRef((props: ResponsesCardProp) => {
  const items = props.items.map(
    (response: MlCopilotServerMessage, index: number) => {
      if ('delta' in response) {
        return <Delta key={index}>{response.delta.delta}</Delta>
      }
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

  return (
    <ChatBubble
      side={'left'}
      wfull={true}
      userAvatar={<AvatarUser src="/public/mleyphun.jpg" />}
    >
      {itemsFilteredNulls.length > 0 ? itemsFilteredNulls : null}
    </ChatBubble>
  )
})

export const ExchangeCard = (props: ExchangeCardProps) => {
  const [startedAt] = useState<Date>(new Date())
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
    'end_of_stream' in (props.responses?.slice(-1)[0] ?? {})
    || props.responses?.some((x) => 'error' in x || 'info' in x)

  useEffect(() => {
    if (isEndOfStream) {
      setShowFullReasoning(false)
    }
  }, [isEndOfStream])

  const maybeError = props.responses.filter((r) => 'error' in r)[0]

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
      {showFullReasoning && props.responses.length > 0 && (
        <div>
          <ExchangeCardStatus
            responses={props.responses}
            onlyShowImmediateThought={false}
            startedAt={startedAt}
            updatedAt={updatedAt}
          />
        </div>
      )}
      { !maybeError &&
      <div
        tabIndex={0}
        role="button"
        className="pl-8 flex flex-row items-center cursor-pointer justify-start gap-2"
        onClick={() => onSeeReasoning()}
      >
        {props.responses.length > 0 && (
          <div>
            <button className="flex justify-center items-center flex-none">
              {showFullReasoning ? (
                <>
                  Collapse <CustomIcon name="collapse" className="w-5 h-5" />
                </>
              ) : (
                <>See reasoning</>
              )}
            </button>
          </div>
        )}
        <ExchangeCardStatus
          maybeError={maybeError}
          responses={props.responses}
          onlyShowImmediateThought={true}
          startedAt={startedAt}
          updatedAt={updatedAt}
        />
      </div> }
      <ResponsesCard items={props.responses} />
    </div>
  )
}
