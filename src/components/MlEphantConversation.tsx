import type { ReactNode } from 'react'
import { useRef, useEffect, useState } from 'react'
import { PromptCard } from '@src/components/PromptCard'
import type { Prompt } from '@src/lib/prompt'
import { MlEphantManagerTransitions } from '@src/machines/mlEphantManagerMachine'

export interface MlEphantConversationProps {
  prompts: Prompt[]
  hasSelection?: boolean
  disabled?: boolean
}

interface MlEphantConversationInputProps {
  onProcess: (requestedPrompt: string) => void
  hasSelection: MlEphantConversationProps['hasSelection']
  disabled?: boolean
}

const Clone = (props) => {
  const refDiv = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (props.xref.current && refDiv.current) {
      const styleSnapshot = window.getComputedStyle(props.xref.current)

      for (let key of styleSnapshot) {
        refDiv.current.style[key] = styleSnapshot[key]
      }
    }

    // Unset so classes can be used instead.
    refDiv.current.style.display = ''
    refDiv.current.style.width = ''
    refDiv.current.style.inlineSize = ''
    refDiv.current.setAttribute('tabindex', -1)
    refDiv.current.focus()
  }, [props.xref.current, refDiv.current])

  return (
    <div ref={refDiv} className={props.className}>
      {props.children}
    </div>
  )
}

export const MlEphantConversationInput = (
  props: MlEphantConversationInputProps
) => {
  const refTextarea = useRef<HTMLTextArea>(null)
  const [value, setValue] = useState('')
  const [lettersForAnimation, setLettersForAnimation] = useState<ReactNode[]>(
    []
  )
  const [isAnimating, setAnimating] = useState(false)

  const onClick = () => {
    if (!value) return
    props.onProcess(value)
    setLettersForAnimation(
      value.split('').map((c, index) => (
        <span
          key={index}
          style={{
            display: 'inline-block',
            animation: `${Math.random() * 2}s linear 0s 1 normal forwards running send-up`,
          }}
        >
          {c}
        </span>
      ))
    )
    setAnimating(true)
    setValue('')

    setTimeout(() => {
      setAnimating(false)
    }, 2000)
  }

  useEffect(() => {
    if (!isAnimating) {
      refTextarea.current.focus()
    }
  }, [isAnimating])

  return (
    <div className="flex flex-col p-4 gap-2">
      <div className="text-sm text-chalkboard-60">Enter a prompt</div>
      <div className="flex flex-row gap-2 items-start">
        <textarea
          ref={refTextarea}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`w-full p-2 ${isAnimating ? 'hidden' : ''}`}
          placeholder="Help get me started on..."
        ></textarea>
        <Clone
          xref={refTextarea}
          className={`${isAnimating ? '' : 'hidden'} w-full p-2`}
        >
          {lettersForAnimation}
        </Clone>
        <div className="flex items-start">
          <button
            disabled={props.disabled}
            onClick={onClick}
            className="w-20 m-0 bg-ml-green p-2"
          >
            {props.hasSelection ? 'Edit' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

export const MlEphantConversation = (props: MlEphantConversationProps) => {
  const refScroll = useRef<HTMLDivElement>(null)

  const onDelete = () => {}
  const onFeedback = () => {}

  useEffect(() => {
    if (refScroll.current) {
      refScroll.current.children[
        refScroll.current.children.length - 1
      ].scrollIntoView()
    }
  }, [props.prompts.length])

  const onProcess = async (requestedPrompt: string) => {
    if (!props.hasSelection) {
      mlEphantManagerActor.send({
        type: MlEphantManagerTransitions.PromptCreateModel,
        prompt: requestedPrompt,
      })
    } else {
      const projectFiles = await collectProjectFiles()
      mlEphantManagerActor.send({
        type: MlEphantManagerTransitions.PromptEditModel,
        prompt: requestedPrompt,
        selections: props.selections,
        projectFiles,
        artifactGraph: props.artifactGraph,
      })
    }
  }

  const promptCards = props.prompts.map((prompt) => (
    <PromptCard
      key={prompt.id}
      {...prompt}
      disabled={prompt.status !== 'completed'}
      onDelete={onDelete}
      onFeedback={onFeedback}
    />
  ))
  return (
    <div className="relative">
      <div className="absolute inset-0">
        <div className="flex flex-col h-full">
          <div className="h-full flex flex-col justify-end overflow-auto">
            <div className="overflow-auto" ref={refScroll}>
              <div className="text-center p-4 text-chalkboard-60 text-md">
                The beginning of this project's Text-to-CAD history.
              </div>
              {promptCards}
            </div>
          </div>
          <div className="border-t">
            <MlEphantConversationInput
              disabled={props.disabled}
              hasSelection={props.hasSelection}
              onProcess={onProcess}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
