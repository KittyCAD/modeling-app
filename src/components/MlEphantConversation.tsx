import type { MlEphantManagerContext } from '@src/machines/mlEphantManagerMachine'
import type { ReactNode } from 'react'
import { useRef, useEffect, useState } from 'react'
import type { Prompt } from '@src/lib/prompt'
import { PromptCard } from '@src/components/PromptCard'
import { CustomIcon } from '@src/components/CustomIcon'

export interface MlEphantConversationProps {
  isLoading: boolean
  prompts: Prompt[]
  promptsThoughts: MlEphantManagerContext['promptsThoughts']
  onProcess: (requestedPrompt: string) => void
  onFeedback: (id: Prompt['id'], feedback: Prompt['feedback']) => void
  onSeeReasoning: (id: Prompt['id']) => void
  onSeeMoreHistory: (nextPage?: string) => void
  disabled?: boolean
  nextPage?: string
  hasPromptCompleted: boolean
  userAvatarSrc?: string
}

interface MlEphantConversationInputProps {
  onProcess: MlEphantConversationProps['onProcess']
  disabled?: boolean
}

const ANIMATION_TIME = 2000

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
    }, ANIMATION_TIME)
  }

  useEffect(() => {
    if (!isAnimating && refDiv.current !== null) {
      refDiv.current.focus()
    }
  }, [isAnimating])

  return (
    <div className="flex flex-col p-4 gap-2">
      <div className="text-sm text-chalkboard-60">Enter a prompt</div>
      <div className="p-2 border b-4 focus-within:b-default flex flex-col gap-2">
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          contentEditable={true}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          data-testid="ml-ephant-conversation-input"
          ref={refDiv}
          onKeyDown={(e) => {
            const isOnlyEnter =
              e.key === 'Enter' && !(e.shiftKey || e.metaKey || e.ctrlKey)
            if (isOnlyEnter) {
              e.preventDefault()
              onClick()
            }
          }}
          className={`outline-none w-full overflow-auto ${isAnimating ? 'hidden' : ''}`}
          style={{ height: '2lh' }}
        ></div>
        <div
          className={`${isAnimating ? '' : 'hidden'} overflow-hidden w-full p-2`}
          style={{ height: heightConvo }}
        >
          {lettersForAnimation}
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="flex justify-end"
          onClick={() => refDiv.current?.focus()}
        >
          <button
            data-testid="ml-ephant-conversation-input-button"
            disabled={props.disabled}
            onClick={onClick}
            className="w-10 m-0 bg-ml-green text-chalkboard-100 hover:bg-ml-green p-2 flex justify-center"
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
  const [autoScroll, setAutoScroll] = useState<boolean>(true)

  const onSeeMoreHistory = () => {
    setAutoScroll(false)
    props.onSeeMoreHistory(props.nextPage)
  }

  const onProcess = (requestedPrompt: string) => {
    setAutoScroll(true)
    props.onProcess(requestedPrompt)
  }

  useEffect(() => {
    if (autoScroll === false) {
      return
    }
    if (refScroll.current === null) {
      return
    }
    if (props.prompts.length === 0) {
      return
    }

    setTimeout(() => {
      if (refScroll.current == null) {
        return
      }
      refScroll.current.scrollTo({
        top: refScroll.current.scrollHeight,
        behavior: 'smooth',
      })
    }, ANIMATION_TIME / 4) // This is a heuristic. I'm sorry. We'd need to
    // hook up "animation is done" otherwise to all children.
  }, [props.prompts.length, autoScroll])

  useEffect(() => {
    if (autoScroll === false) {
      return
    }
    if (refScroll.current == null) {
      return
    }
    if (!props.hasPromptCompleted) {
      return
    }
    refScroll.current.scrollTo({
      top: refScroll.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [props.hasPromptCompleted, autoScroll])

  const promptCards = props.prompts.map((prompt) => (
    <PromptCard
      key={prompt.id}
      {...prompt}
      userAvatar={props.userAvatarSrc}
      thoughts={props.promptsThoughts.get(prompt.id)}
      disabled={prompt.status !== 'completed'}
      onSeeReasoning={props.onSeeReasoning}
      onFeedback={props.onFeedback}
    />
  ))
  return (
    <div className="relative">
      <div className="absolute inset-0">
        <div className="flex flex-col h-full">
          <div className="h-full flex flex-col justify-end overflow-auto">
            <div className="overflow-auto" ref={refScroll}>
              {props.isLoading === false ? (
                props.nextPage ? (
                  /* eslint-disable-next-line jsx-a11y/no-static-element-interactions */
                  <div
                    onClick={() => onSeeMoreHistory()}
                    className="cursor-pointer underline text-center p-4 text-chalkboard-60 text-sm"
                  >
                    See more history
                  </div>
                ) : (
                  <div className="text-center p-4 text-chalkboard-60 text-md">
                    The beginning of this project's Text-to-CAD history.
                  </div>
                )
              ) : (
                <div className="text-center p-4 text-chalkboard-60 text-md animate-pulse">
                  Loading history
                </div>
              )}
              {promptCards}
            </div>
          </div>
          <div className="border-t b-4">
            <MlEphantConversationInput
              disabled={props.disabled || props.isLoading}
              onProcess={onProcess}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
