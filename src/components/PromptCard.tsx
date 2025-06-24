import ms from 'ms'
import type { Prompt } from '@src/lib/prompt'

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
    <div className="flex flex-row gap-2">
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
      className="rounded-full bg-gray-100"
      onClick={props.onClick}
      disabled={
        props.disabled ||
        props.status === 'queued' ||
        props.status === 'in_progress'
      }
    >
      {props.status === 'completed' ? 'Create' : 'Pending'}
    </button>
  )
}

export const PromptCard = (props: PromptCardProps) => {
  const cssCard = 'flex flex-col border rounded-md p-2 gap-2 justify-between'

  return (
    <div className={`${cssCard} ${props.disabled ? 'text-chalkboard-60' : ''}`}>
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
        <PromptCardActionButton
          status={props.status}
          disabled={props.disabled}
          onClick={() => props.onAction?.(props.id, props.prompt)}
        />
        <div>
          {ms(new Date(props.created_at).getTime(), { long: true })} ago
        </div>
      </div>
    </div>
  )
}
