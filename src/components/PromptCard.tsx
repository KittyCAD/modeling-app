import ms from 'ms'
import { CustomIcon } from '@src/components/CustomIcon'
import type { Prompt } from '@src/lib/prompt'
import type { IResponseMlConversation } from '@src/lib/textToCad'
import { useState } from 'react'
import type { Thought } from '@src/machines/mlEphantManagerMachine'
import { Thinking } from '@src/components/Thinking'

// In the future we can split this out but the code is 99% the same as
// the PromptCard, which came first.
export interface ConvoCardProps extends IResponseMlConversation {
  onAction?: (prompt: IResponseMlConversation['first_prompt']) => void
}

export const ConvoCard = (props: ConvoCardProps) => {
  const cssCard = `flex flex-col border rounded-md p-2 gap-2 justify-between`
  return (
    <div className={cssCard}>
      <div className="flex flex-row justify-between gap-2">
        <div>{props.first_prompt}</div>
      </div>
      <div className="flex flex-row justify-between">
        <div className="flex flex-row gap-2">
          {props.onAction !== undefined && (
            <PromptCardActionButton
              status={'completed' as Prompt['status']}
              onClick={() => props.onAction?.(props.first_prompt)}
            />
          )}
        </div>
        <div className="text-sm text-chalkboard-70">
          {ms(Date.now() - new Date(props.created_at).getTime(), {
            long: true,
          })}{' '}
          ago
        </div>
      </div>
    </div>
  )
}

export interface PromptCardProps extends Prompt {
  disabled?: boolean
  thoughts?: Thought[]
  userAvatar?: string
  onSeeReasoning: (id: Prompt['id']) => void
  onAction?: (id: Prompt['id'], prompt: Prompt['prompt']) => void
  onFeedback?: (id: string, feedback: Prompt['feedback']) => void
}

export const PromptFeedback = (props: {
  id: Prompt['id']
  selected?: Prompt['feedback']
  disabled?: boolean
  onFeedback: (id: Prompt['id'], feedback: Prompt['feedback']) => void
}) => {
  return (
    <div className="flex flex-row select-none">
      <button
        onClick={() => props.onFeedback(props.id, 'thumbs_up')}
        disabled={props.disabled}
      >
        <span
          style={{
            filter:
              props.selected === 'thumbs_up'
                ? 'hue-rotate(110deg)'
                : 'grayscale(100%)',
          }}
        >
          👍
        </span>
      </button>
      <button
        onClick={() => props.onFeedback(props.id, 'thumbs_down')}
        disabled={props.disabled}
      >
        <span
          style={{
            filter:
              props.selected === 'thumbs_down'
                ? 'hue-rotate(270deg)'
                : 'grayscale(100%)',
          }}
        >
          👎
        </span>
      </button>
    </div>
  )
}

export const PromptCardActionButton = (props: {
  status: Prompt['status']
  disabled?: boolean
  onClick: () => void
}) => {
  return (
    <button
      className="rounded-full bg-gray-100"
      onClick={props.onClick}
      disabled={
        props.disabled ||
        props.status === 'queued' ||
        props.status === 'in_progress'
      }
    >
      Create
    </button>
  )
}

export const PromptCardStatus = (props: {
  id: Prompt['id']
  thoughts?: Thought[]
  status: Prompt['status']
  onlyShowImmediateThought: boolean
  startedAt: Prompt['started_at']
  updatedAt?: Prompt['updated_at']
  maybeError?: string
}) => {
  const thinker = (
    <Thinking
      thoughts={props.thoughts}
      onlyShowImmediateThought={props.onlyShowImmediateThought}
    />
  )

  const failed = props.onlyShowImmediateThought ? (
    <div>{props.maybeError}</div>
  ) : (
    thinker
  )

  const completed = (
    <div className="p-2 border border-transparent">
      Worked for{' '}
      {ms(
        new Date(props.updatedAt ?? new Date()).getTime() -
          new Date(props.startedAt ?? new Date()).getTime(),
        { long: true }
      )}
    </div>
  )

  return (
    <div className="text-sm text-chalkboard-70">
      {props.status === 'failed'
        ? failed
        : props.status === 'completed' &&
            props.onlyShowImmediateThought === true
          ? completed
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

export const PromptCard = (props: PromptCardProps) => {
  const [showFullReasoning, setShowFullReasoning] = useState<boolean>(false)
  const [showSeeReasoning, setShowSeeReasoning] = useState<boolean>(false)

  const cssCard = `flex flex-col p-2 gap-2 justify-between
    transition-height duration-500 overflow-hidden
    ${props.disabled ? 'text-chalkboard-60' : ''}
  `

  const onSeeReasoning = () => {
    props.onSeeReasoning(props.id)
    setShowFullReasoning(!showFullReasoning)
  }

  const cssPrompt =
    props.status !== 'failed'
      ? 'break-all shadow-sm bg-chalkboard-20 text-chalkboard-100 border rounded-t-md rounded-bl-md pl-4 pr-4 pt-2 pb-2'
      : 'break-all shadow-sm bg-chalkboard-20 text-chalkboard-60 border rounded-t-md rounded-bl-md pl-4 pr-4 pt-2 pb-2'

  return (
    <div className={cssCard}>
      <div className="flex flex-row justify-end items-end gap-2">
        <div className="flex flex-col items-end gap-2 w-full">
          <PromptFeedback
            id={props.id}
            selected={props.feedback}
            disabled={props.disabled}
            onFeedback={(...args) => props.onFeedback?.(...args)}
          />
          <div className={cssPrompt}>{props.prompt}</div>
        </div>
        <div className="w-fit-content">
          <AvatarUser src={props.userAvatar} />
        </div>
      </div>
      {showFullReasoning && (
        <div>
          <PromptCardStatus
            id={props.id}
            status={props.status}
            maybeError={props.error}
            thoughts={props.thoughts}
            onlyShowImmediateThought={false}
            startedAt={props.started_at}
            updatedAt={props.updated_at}
          />
        </div>
      )}
      <div className="flex flex-row justify-end gap-2 items-center pl-2 pr-10">
        <div
          className={`flex flex-row gap-2 ${showSeeReasoning ? 'hidden' : ''}`}
          onMouseEnter={() =>
            props.thoughts !== undefined &&
            props.thoughts.length > 0 &&
            setShowSeeReasoning(true)
          }
        >
          {props.onAction !== undefined && (
            <PromptCardActionButton
              status={props.status}
              disabled={props.disabled}
              onClick={() => props.onAction?.(props.id, props.prompt)}
            />
          )}
          <PromptCardStatus
            id={props.id}
            status={props.status}
            maybeError={props.error}
            thoughts={props.thoughts}
            onlyShowImmediateThought={true}
            startedAt={props.started_at}
            updatedAt={props.updated_at}
          />
        </div>
        <div
          onMouseLeave={() => setShowSeeReasoning(false)}
          className={showSeeReasoning || showFullReasoning ? '' : 'hidden'}
        >
          <button className="w-full p-2" onClick={() => onSeeReasoning()}>
            {showFullReasoning ? 'Hide reasoning' : 'See reasoning'}
          </button>
        </div>
      </div>
    </div>
  )
}
