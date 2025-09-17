import { Popover, Transition } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ExchangeCard } from '@src/components/ExchangeCard'
import type { Prompt } from '@src/lib/prompt'
import type { MlEphantManagerContext2, Conversation, Exchange } from '@src/machines/mlEphantManagerMachine2'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'

export interface MlEphantConversationProps {
  isLoading: boolean
  conversation?: Conversation
  onProcess: (request: string) => void
  onSeeMoreHistory: (nextPage?: string) => void
  disabled?: boolean
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

const MLEphantConversationStarter = () => {
  return (
    <div className="p-8 text-sm">
      <h2 className="text-lg font-bold">
        Welcome to{' '}
        <span className="dark:text-ml-green light:underline decoration-ml-green underline-offset-4">
          Text-to-CAD
        </span>
      </h2>
      <p className="my-4">Here are some tips for effective prompts:</p>
      <ul className="list-disc pl-4">
        <li className="my-4">
          Be as explicit as possible when describing geometry. Use dimensions,
          use spatial relationships.
        </li>
        <li className="my-4">
          Try using Text-to-CAD to make a model parametric, it's cool.
        </li>
        <li className="my-4">
          Text-to-CAD treats every prompt as a separate instruction.
        </li>
      </ul>
    </div>
  )
}

export const MlEphantConversation2 = (props: MlEphantConversationProps) => {
  const refScroll = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState<boolean>(true)

  const onSeeMoreHistory = () => {
    setAutoScroll(false)
    props.onSeeMoreHistory(props.conversation?.pageToken)
  }

  const onProcess = (request: string) => {
    setAutoScroll(true)
    props.onProcess(request)
  }

  useEffect(() => {
    if (autoScroll === false) {
      return
    }
    if (refScroll.current === null) {
      return
    }
    if (props.conversation?.exchanges.length === 0) {
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
  }, [props.conversation?.exchanges.length, autoScroll])

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

  const exchangeCards = props.conversation?.exchanges.flatMap((exchange: Exchange, exchangeIndex: number) => (
    <ExchangeCard
      key={`exchange-${exchangeIndex}`}
      {...exchange}
      userAvatar={props.userAvatarSrc}
    />
  ))
  return (
    <div className="relative">
      <div className="absolute inset-0">
        <div className="flex flex-col h-full">
          <div className="h-full flex flex-col justify-end overflow-auto">
            <div className="overflow-auto" ref={refScroll}>
              {props.isLoading === false ? (
                props.conversation?.pageToken ? (
                  /* eslint-disable-next-line jsx-a11y/no-static-element-interactions */
                  <div
                    onClick={() => onSeeMoreHistory()}
                    className="cursor-pointer underline text-center p-4 text-chalkboard-60 text-sm"
                  >
                    See more history
                  </div>
                ) : (
                  <MLEphantConversationStarter />
                )
              ) : (
                <div className="text-center p-4 text-chalkboard-60 text-md animate-pulse">
                  Loading history
                </div>
              )}
              {exchangeCards}
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

export const MLEphantConversationPaneMenu2 = () => (
  <Popover className="relative">
    <Popover.Button className="p-0 !bg-transparent border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 ui-open:!border-primary dark:ui-open:!border-chalkboard-70 !outline-none">
      <CustomIcon name="questionMark" className="w-5 h-5" />
    </Popover.Button>

    <Transition
      enter="duration-100 ease-out"
      enterFrom="opacity-0 -translate-y-2"
      enterTo="opacity-100 translate-y-0"
      as={Fragment}
    >
      <Popover.Panel className="w-max max-w-md z-10 bg-default flex flex-col gap-4 absolute top-full left-auto right-0 mt-1 p-4 border border-solid b-5 rounded shadow-lg">
        <div className="flex gap-2 items-center">
          <CustomIcon
            name="beaker"
            className="w-5 h-5 bg-ml-green dark:text-chalkboard-100 rounded-sm"
          />
          <p className="text-base font-bold">
            <span className="dark:text-ml-green light:underline decoration-ml-green underline-offset-4">
              Text-to-CAD
            </span>{' '}
            is experimental
          </p>
        </div>
        <p className="text-sm">
          Text-to-CAD treats every prompt as separate. Full copilot mode with
          conversational memory is coming soon. Conversations are not currently
          shared between computers.
        </p>
      </Popover.Panel>
    </Transition>
  </Popover>
)

