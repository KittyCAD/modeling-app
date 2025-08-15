import type { ReactNode } from 'react'
import { useRef, useEffect, useState } from 'react'
import type { Prompt } from '@src/lib/prompt'
import type { FileMeta } from '@src/lib/types'
import { PromptCard } from '@src/components/PromptCard'
import { CustomIcon } from '@src/components/CustomIcon'

export interface MlEphantConversationProps {
  isLoading: boolean
  prompts: Prompt[]
  onProcess: (requestedPrompt: string) => void
  disabled?: boolean
}

interface MlEphantConversationInputProps {
  onProcess: MlEphantConversationProps['onProcess']
  disabled?: boolean
}

export const MlEphantConversationInput = (
  props: MlEphantConversationInputProps
) => {
  const refDiv = useRef<HTMLDivElement>(null)
  const [heightConvo, setHeightConvo] = useState(0)
  const [lettersForAnimation, setLettersForAnimation] = useState<ReactNode[]>(
    []
  )
  const [isAnimating, setAnimating] = useState(false)

  const onClick = () => {
    if (props.disabled) return

    const value = refDiv.current?.innerText
    if (!value) return
    setHeightConvo(refDiv.current.getBoundingClientRect().height)

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
    refDiv.current.innerText = ''

    setTimeout(() => {
      setAnimating(false)
    }, 2000)
  }

  useEffect(() => {
    if (!isAnimating && refDiv.current !== null) {
      refDiv.current.focus()
    }
  }, [isAnimating])

  return (
    <div className="flex flex-col p-4 gap-2">
      <div className="text-sm text-chalkboard-60">Enter a prompt</div>
      <div className="p-2 border flex flex-col gap-2">
        <div
          contentEditable={true}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          ref={refDiv}
          className={`outline-none w-full overflow-auto ${isAnimating ? 'hidden' : ''}`}
          style={{ height: '2lh' }}
        ></div>
        <div
          className={`${isAnimating ? '' : 'hidden'} overflow-hidden w-full p-2`}
          style={{ height: heightConvo }}
        >
          {lettersForAnimation}
        </div>
        <div className="flex justify-end">
          <button
            disabled={props.disabled}
            onClick={onClick}
            className="w-10 m-0 bg-ml-green p-2 flex justify-center"
          >
            <CustomIcon name="arrowUp" className="w-5 h-5 animate-bounce" />
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
              {props.isLoading === false ? (
                <div className="text-center p-4 text-chalkboard-60 text-md">
                  The beginning of this project's Text-to-CAD history.
                </div>
              ) : (
                <div className="text-center p-4 text-chalkboard-60 text-md animate-pulse">
                  Loading history
                </div>
              )}
              {promptCards}
            </div>
          </div>
          <div className="border-t">
            <MlEphantConversationInput
              disabled={props.disabled || props.isLoading}
              onProcess={props.onProcess}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
