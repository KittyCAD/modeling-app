import ms from 'ms'
import { Prompt } from '@src/lib/prompt'

interface PromptCardProps extends Prompt {
  onAction?: (id: Prompt['id']) => void,
  onDelete?: (id: Prompt['id']) => void,
  onFeedback?: (id: string, feedback: Prompt['feedback']) => void,
}

export const PromptFeedback = (props: {
  selected: Prompt['feedback'],
  onFeedback: (id: Prompt['id'], feedback: Prompt['feedback']) => void,
}) => {
  const cssUp = 'border-green-500'
  const cssDown = 'border-red-500'

  return <div className="flex flex-row gap-2">
    <button className={cssUp}>Good</button>
    <button className={cssDown}>Bad</button>
  </div>
}

export const PromptCardActionButton = (props: {
  status: Prompt['status'],
  onClick: () => void,
}) => {
  return <button
    className="rounded-full bg-gray-100"
    onClick={props.onClick}
    disabled={props.status === 'queued' || props.status === 'in_progress'}>
    { props.status === 'completed' ? 'Create' : 'Pending' }
  </button>
}

export const PromptCard = (props: PromptCardProps) => {
  return <div className="flex flex-col border rounded-md p-2 gap-2 justify-between">
    <div className="flex flex-row justify-between gap-2">
      <div>{ props.prompt }</div>
      <div className="w-fit flex flex-col items-end">
        <button onClick={() => props.onDelete?.(props.id)}>Delete</button>
        <PromptFeedback
          selected={ props.feedback }
          onFeedback={props.onFeedback}
        />
      </div>
    </div>
    <div className="flex flex-row justify-between">
      <PromptCardActionButton status={props.status} onClick={() => props.onAction?.(props.id)} />
      <div>{ ms(new Date(props.created_at).getTime(), { long: true }) } ago</div>
    </div>
  </div>
}
