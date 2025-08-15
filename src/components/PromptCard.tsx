import ms from 'ms'
import type { Prompt } from '@src/lib/prompt'
import type { IResponseMlConversation } from '@src/lib/textToCad.ts'
import { useEffect, useState, useRef, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import Loading from '@src/components/Loading'

// In the future we can split this out but the code is 99% the same as
// the PromptCard, which came first.
export interface ConvoCardProps extends IResponseMlConversation {
  onAction?: (prompt: IResponseMlConversation['first_prompt']) => void
}

export const ConvoCard = (props: ConvoCardProps) => {
  const cssCard = `flex flex-col border rounded-md p-2 gap-2 justify-between
    transition-height duration-500 overflow-hidden
  `
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
          {ms(new Date(props.created_at).getTime() / 1000, { long: true })} ago
        </div>
      </div>
    </div>
  )
}

export interface PromptCardProps extends Prompt {
  disabled?: boolean
  onAction?: (id: Prompt['id'], prompt: Prompt['prompt']) => void
  onDelete?: (id: Prompt['id']) => void
  onFeedback?: (id: string, feedback: Prompt['feedback']) => void
}

export const PromptFeedback = (props: {
  id: Prompt['id']
  selected?: Prompt['feedback']
  disabled?: boolean
  onFeedback: (id: Prompt['id'], feedback: Prompt['feedback']) => void
}) => {
  const cssUp =
    props.selected === undefined || props.selected === 'thumbs_up'
      ? 'border-green-300'
      : 'border-green-100 text-chalkboard-60'
  const cssDown =
    props.selected === undefined || props.selected === 'thumbs_down'
      ? 'border-red-300'
      : 'border-red-100 text-chalkboard-60'

  return (
    <div className="flex flex-row gap-2 select-none">
      <button
        onClick={() => props.onFeedback(props.id, 'thumbs_up')}
        disabled={props.disabled}
        className={cssUp}
      >
        Good
      </button>
      <button
        onClick={() => props.onFeedback(props.id, 'thumbs_down')}
        disabled={props.disabled}
        className={cssDown}
      >
        Bad
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
      className="rounded-full bg-gray-100 select-none"
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
  status: Prompt['status']
}) => {
  const loading = (
    <Loading isCompact={true} isDummy={true}>
      Thinking
    </Loading>
  )
  const Status: { [key in Prompt['status']]: ReactNode | null } = {
    completed: null,
    in_progress: loading,
    queued: loading,
    uploaded: loading,
    // A bit less harsh wording
    failed: <>Unsuccessful</>,
  }

  return (
    <div className="select-none text-sm text-chalkboard-70">
      {Status[props.status]}
    </div>
  )
}

export const PromptCard = (props: PromptCardProps) => {
  const refCard = useRef<HTMLDivElement>(null)
  const refHeight = useRef<number>(0)
  const [style, setStyle] = useState({})
  const cssCard = `flex flex-col border rounded-md p-2 gap-2 justify-between
    transition-height duration-500 overflow-hidden
    ${props.disabled ? 'text-chalkboard-60' : ''}
    ${props.status === 'in_progress' || props.status === 'queued' ? 'animate-pulse' : ''}
  `
  useLayoutEffect(() => {
    if (refHeight.current === null) {
      return
    }
    if (refCard.current === null) {
      return
    }
    refHeight.current = refCard.current.getBoundingClientRect().height
    refCard.current.style.height = '0'
  }, [])

  useEffect(() => {
    setStyle({ height: refHeight.current })
  }, [])

  return (
    <div ref={refCard} className={cssCard} style={style}>
      <div className="flex flex-row justify-between gap-2">
        <div>{props.prompt}</div>
        <div className="w-fit flex flex-col items-end">
          {/* TODO: */}
          {/* <button disabled={props.disabled} onClick={() => props.onDelete?.(props.id)}>Delete</button> */}
          <PromptFeedback
            id={props.id}
            selected={props.feedback}
            disabled={props.disabled}
            onFeedback={(...args) => props.onFeedback?.(...args)}
          />
        </div>
      </div>
      <div className="flex flex-row justify-between">
        <div className="flex flex-row gap-2">
          {props.onAction !== undefined && (
            <PromptCardActionButton
              status={props.status}
              disabled={props.disabled}
              onClick={() => props.onAction?.(props.id, props.prompt)}
            />
          )}
          <PromptCardStatus status={props.status} />
        </div>
        <div className="text-sm text-chalkboard-70">
          {ms(new Date(props.created_at).getTime(), { long: true })} ago
        </div>
      </div>
    </div>
  )
}
