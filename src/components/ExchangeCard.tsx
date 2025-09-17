import type { MlCopilotServerMessage, MlCopilotClientMessage } from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { Thinking } from '@src/components/Thinking'
import { type Exchange } from '@src/machines/mlEphantManagerMachine2'
import ms from 'ms'
import { useEffect, useState } from 'react'

export type ExchangeCardProps = Exchange & {
  userAvatar?: string
}

type MlCopilotServerMessageError<T = MlCopilotServerMessage> = T extends { error: any }
? T
: never

export const ExchangeCardStatus = (props: {
  reasoning?: MlCopilotServerMessage[]
  onlyShowImmediateThought: boolean
  startedAt: Date,
  updatedAt?: Date,
  maybeError?: MlCopilotServerMessageError
}) => {
  const thinker = (
    <Thinking
      thoughts={props.reasoning}
      onlyShowImmediateThought={props.onlyShowImmediateThought}
    />
  )

  const failed = props.onlyShowImmediateThought ? (
    <div data-testid="exchange-card-status-failed">{props.maybeError?.error.detail}</div>
  ) : (
    thinker
  )

  return (
    <div className="text-sm text-chalkboard-70">
      {props.maybeError
        ? failed
        : thinker}
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
  userAvatar?: string
}

type MlCopilotClientMessageUser<T = MlCopilotClientMessage> = T extends { type: 'user' }
? T
: never

function isMlCopilotUserRequest(x: unknown): x is MlCopilotClientMessageUser {
  return typeof x === 'object' && x !== null && 'type' in x && x.type === 'user'
}

export const RequestCard = (props: RequestCardProps) => {
  if (!isMlCopilotUserRequest(props)) {
    return null
  }

  const cssRequest = 'select-text whitespace-pre-line hyphens-auto shadow-sm bg-2 text-default border b-4 rounded-t-md rounded-bl-md pl-4 pr-4 pt-2 pb-2'
  return props.content === 'undefined'
  ? null 
  : 
  <div className="flex flex-row justify-end items-end gap-2">
  <div className="flex flex-col items-end gap-2 w-full">
    <div style={{ wordBreak: 'break-word' }} className={cssRequest}>
      { props.content }
    </div>
  </div>
  <div className="w-fit-content">
    <AvatarUser src={props.userAvatar} />
  </div>
  </div>
}

type ResponsesCardProp = {
  items: Exchange['responses']
}
// This can be used to show `tool_output`
export const ResponsesCard = (props: ResponsesCardProp) => {
  return null
}

export const ExchangeCard = (props: ExchangeCardProps) => {
  const [startedAt] = useState<Date>(new Date())
  const [updatedAt, setUpdatedAt] = useState<Date | undefined>(undefined)

  const hasReasoningToShow =
    props.responses !== undefined && props.responses.some((response) => 'reasoning' in response)

  const [showFullReasoning, setShowFullReasoning] = useState<boolean>(false)

  const cssCard = `flex flex-col p-2 gap-2 justify-between
    transition-height duration-500 overflow-hidden
  `

  const onSeeReasoning = () => {
    setShowFullReasoning(!showFullReasoning)
  }

  useEffect(() => {
    if (props.responses.some((response) => 'end_of_stream' in response)) {
      setUpdatedAt(new Date())
    }
  }, [props.responses])

  return (
    <div className={cssCard}>
      { isMlCopilotUserRequest(props.request) && <RequestCard {...props.request} /> }
      <ResponsesCard items={props.responses} />
      {showFullReasoning && (
        <div>
          <ExchangeCardStatus
            maybeError={props.responses.filter((r) => 'error' in r)[0]}
            reasoning={props.responses}
            onlyShowImmediateThought={false}
            startedAt={startedAt}
            updatedAt={updatedAt}
          />
        </div>
      )}
      <div
        className={`${hasReasoningToShow ? 'group/reasoning' : ''} relative pl-2 pr-10`}
      >
        <div className="flex flex-row justify-end gap-2 group-hover/reasoning:invisible">
          <ExchangeCardStatus
            maybeError={props.responses.filter((r) => 'error' in r)[0]}
            reasoning={props.responses}
            onlyShowImmediateThought={true}
            startedAt={startedAt}
            updatedAt={updatedAt}
          />
        </div>
        <div
          className={
            'hidden group-hover/reasoning:block absolute right-0 top-1/2 -translate-y-1/2'
          }
        >
          <button className="w-fit p-2" onClick={() => onSeeReasoning()}>
            {showFullReasoning ? 'Hide reasoning' : 'See reasoning'}
          </button>
        </div>
      </div>
    </div>
  )
}

