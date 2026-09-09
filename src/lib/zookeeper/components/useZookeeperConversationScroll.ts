import { useCallback, useLayoutEffect, useRef } from 'react'

const PROMPT_POSITION = 0.2
const SCROLL_TOLERANCE = 4
const PROMPT_SCROLL_DURATION_MS = 300

/** Reserve room for the latest turn, without moving a reader who scrolled away. */
export function useZookeeperConversationScroll({
  scopeKey,
  promptIndex,
  visible,
}: {
  scopeKey?: string
  promptIndex: number
  visible: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<{
    frame: number
    target: number
  } | null>(null)
  const state = useRef({
    scopeKey,
    initialized: false,
    visible: false,
    promptIndex: -1,
    anchored: false,
    following: true,
    interacted: false,
    scrollTop: 0,
  })

  const stopAnimation = useCallback(() => {
    if (!animationRef.current) return
    cancelAnimationFrame(animationRef.current.frame)
    animationRef.current = null
  }, [])

  const animateTo = useCallback(
    (target: number) => {
      stopAnimation()
      const scroll = scrollRef.current
      if (!scroll) return
      if (
        Math.abs(target - scroll.scrollTop) < 1 ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        scroll.scrollTop = target
        return
      }

      const from = scroll.scrollTop
      const startedAt = performance.now()
      const animation = { frame: 0, target }
      animationRef.current = animation
      const step = (now: number) => {
        if (animationRef.current !== animation) return
        const progress = Math.max(
          0,
          Math.min(1, (now - startedAt) / PROMPT_SCROLL_DURATION_MS)
        )
        const eased = 1 - (1 - progress) ** 3
        scroll.scrollTop = from + (animation.target - from) * eased
        state.current.scrollTop = scroll.scrollTop
        if (progress < 1) {
          animation.frame = requestAnimationFrame(step)
        } else {
          animationRef.current = null
        }
      }
      animation.frame = requestAnimationFrame(step)
    },
    [stopAnimation]
  )

  const measure = useCallback(
    (animate = false) => {
      const scroll = scrollRef.current
      const content = contentRef.current
      const prompt = promptRef.current
      const spacer = spacerRef.current
      if (!scroll || !content || !spacer || scroll.clientHeight === 0) return

      const current = state.current
      if (current.anchored && prompt) {
        const height = scroll.clientHeight
        const oldPadding = parseFloat(content.style.paddingTop) || 0
        const naturalPromptTop =
          prompt.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          oldPadding
        // Even a first prompt without a welcome message can reach the anchor.
        content.style.paddingTop = `${Math.max(0, height * PROMPT_POSITION - naturalPromptTop)}px`
        const contentBelowPrompt =
          content.getBoundingClientRect().bottom -
          prompt.getBoundingClientRect().top
        spacer.style.height = `${Math.max(0, height * (1 - PROMPT_POSITION) - contentBelowPrompt)}px`
      } else {
        content.style.paddingTop = '0px'
        spacer.style.height = '0px'
      }

      if (current.following) {
        // With the spacer, the bottom is the prompt anchor until the response
        // fills the viewport. After that it follows the growing response.
        current.interacted = false
        const target = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
        if (animate) {
          animateTo(target)
        } else if (animationRef.current) {
          // Streaming and resizing can change the destination, but must not
          // restart the submit animation or snap it to the end.
          animationRef.current.target = target
        } else {
          scroll.scrollTop = target
        }
      }
      current.scrollTop = scroll.scrollTop
    },
    [animateTo]
  )

  // Measure every committed render too: reasoning can collapse before the
  // ResizeObserver runs, and we must replace that space before painting.
  useLayoutEffect(() => {
    const current = state.current
    if (current.scopeKey !== scopeKey) {
      stopAnimation()
      current.scopeKey = scopeKey
      current.initialized = false
      current.anchored = false
      current.following = true
      current.interacted = false
    }
    if (!visible) {
      stopAnimation()
      current.visible = false
      // Recovery/loading replaces the transcript, so its layout must not
      // inherit the space reserved for an in-progress conversation.
      if (contentRef.current) contentRef.current.style.paddingTop = '0px'
      if (spacerRef.current) spacerRef.current.style.height = '0px'
      return
    }
    const wasVisible = current.visible
    const restoreScrollTop =
      !wasVisible && current.initialized && !current.following
        ? current.scrollTop
        : undefined
    current.visible = true

    const isNewPrompt =
      current.initialized && wasVisible && promptIndex > current.promptIndex
    if (isNewPrompt) {
      current.anchored = true
      current.following = true
    } else if (
      promptIndex < current.promptIndex ||
      promptIndex < 0 ||
      (!wasVisible && promptIndex !== current.promptIndex)
    ) {
      stopAnimation()
      current.anchored = false
    }
    current.initialized = true
    current.promptIndex = promptIndex
    measure(isNewPrompt)
    if (restoreScrollTop !== undefined && scrollRef.current) {
      scrollRef.current.scrollTop = restoreScrollTop
      current.scrollTop = scrollRef.current.scrollTop
    }
  })

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!visible || !scroll || !content) return

    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => measure())
    })
    observer.observe(scroll)
    observer.observe(content)
    const onInteraction = () => {
      if (animationRef.current) {
        stopAnimation()
        state.current.following = false
      }
      state.current.interacted = true
    }
    const onWheel = (event: WheelEvent) => {
      // Let a nested reasoning pane consume its own wheel input. At its edge,
      // the browser can chain scrolling to the conversation instead.
      for (const target of event.composedPath()) {
        if (target === scroll) break
        if (
          target instanceof HTMLElement &&
          target.scrollHeight > target.clientHeight &&
          ['auto', 'scroll'].includes(getComputedStyle(target).overflowY) &&
          (event.deltaY < 0
            ? target.scrollTop > 0
            : target.scrollTop + target.clientHeight < target.scrollHeight)
        )
          return
      }
      onInteraction()
      // Stop before the browser's deferred scroll event: a streamed update
      // arriving in between must not pull the reader back to the bottom.
      if (event.deltaY < 0) state.current.following = false
    }
    const onScroll = (event: Event) => {
      // Reasoning has its own scroll region inside the transcript.
      if (event.target !== scroll) return
      const current = state.current
      if (
        current.interacted &&
        Math.abs(scroll.scrollTop - current.scrollTop) > SCROLL_TOLERANCE
      ) {
        current.following =
          scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <
          SCROLL_TOLERANCE
      }
      current.scrollTop = scroll.scrollTop
    }
    scroll.addEventListener('scroll', onScroll)
    scroll.addEventListener('wheel', onWheel, { passive: true })
    scroll.addEventListener('touchstart', onInteraction, { passive: true })
    scroll.addEventListener('pointerdown', onInteraction)
    scroll.addEventListener('keydown', onInteraction)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      stopAnimation()
      scroll.removeEventListener('scroll', onScroll)
      scroll.removeEventListener('wheel', onWheel)
      scroll.removeEventListener('touchstart', onInteraction)
      scroll.removeEventListener('pointerdown', onInteraction)
      scroll.removeEventListener('keydown', onInteraction)
    }
  }, [measure, stopAnimation, visible])

  return {
    scrollRef,
    contentRef,
    promptRef,
    spacerRef,
  }
}
