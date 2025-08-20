import { SafeRenderer } from '@src/lib/markdown'
import { Marked, escape, unescape } from '@ts-stack/markdown'

import { CustomIcon } from '@src/components/CustomIcon'
import { useEffect, useState, useRef, type ReactNode } from 'react'

export const Generic = (props: {
  content: string
}) => {
  return <div>{props.content}</div>
}

export const KclCodeExamples = (props: { content: string }) => {
  return (
    <Thought
      heading={
        <ThoughtHeader icon={<CustomIcon name="file" className="w-6 h-6" />}>
          KCL Sample
        </ThoughtHeader>
      }
    >
      <ThoughtContent>
        <div>
          <pre>{props.content}</pre>
        </div>
      </ThoughtContent>
    </Thought>
  )
}

export const GeneratedKclCode = (props: { code: string }) => {
  return (
    <Thought
      heading={
        <ThoughtHeader icon={<CustomIcon name="code" className="w-6 h-6" />}>
          'Generated KCL Code'
        </ThoughtHeader>
      }
    >
      <ThoughtContent>
        <div>
          <pre>{props.code}</pre>
        </div>
      </ThoughtContent>
    </Thought>
  )
}

export const ErrorneousThing = (props: { content: string }) => {
  return (
    <Thought
      heading={
        <ThoughtHeader
          icon={<CustomIcon name="triangleExclamation" className="w-6 h-6" />}
        >
          Error detected
        </ThoughtHeader>
      }
    >
      <ThoughtContent>
        return <div>{props.content}</div>
      </ThoughtContent>
    </Thought>
  )
}

export const KclDocs = (props: { content: string }) => {
  const options = {
    gfm: true,
    breaks: true,
    sanitize: true,
    escape,
    unescape,
  }
  return (
    <Thought
      heading={
        <ThoughtHeader
          icon={<CustomIcon name="folderOpen" className="w-6 h-6" />}
        >
          Documentation
        </ThoughtHeader>
      }
    >
      <ThoughtContent>
        <div
          dangerouslySetInnerHTML={{
            __html: Marked.parse(props.content, {
              renderer: new SafeRenderer(options),
              ...options,
            }),
          }}
        ></div>
      </ThoughtContent>
    </Thought>
  )
}

export const FeatureTreeOutline = (props: { content: string }) => {
  const options = {
    gfm: true,
    breaks: true,
    sanitize: true,
    unescape,
    escape,
  }
  return (
    <Thought
      heading={
        <ThoughtHeader
          icon={<CustomIcon name="fileExplorer" className="w-6 h-6" />}
        >
          Design Plan
        </ThoughtHeader>
      }
    >
      <ThoughtContent>
        <div
          dangerouslySetInnerHTML={{
            __html: Marked.parse(props.content, {
              renderer: new SafeRenderer(options),
              ...options,
            }),
          }}
        ></div>
      </ThoughtContent>
    </Thought>
  )
}

export const ThoughtFor = (props: {
  start: number
}) => {
  return <div>Worked for {ms(props.start - Date.now(), { long: true })}</div>
}

export const ThoughtHeader = (props: {
  icon: ReactNode
  children?: ReactNode
}) => {
  return (
    <div className="flex flex-row gap-2 text-chalkboard-70 font-bold items-center">
      <div className="flex justify-center items-center">{props.icon}</div>
      <div className="w-full">{props.children}</div>
    </div>
  )
}

const HEIGHT_LINE_MAX_CONTENT = 4

export const ThoughtContent = (props: { children?: ReactNode }) => {
  const [needsExpansion, setNeedsExpansion] = useState<boolean>(false)
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const refDivChildren = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (refDivChildren.current === null) {
      return
    }
    const bb = refDivChildren.current.getBoundingClientRect()
    const style = getComputedStyle(refDivChildren.current)
    if (bb.height > parseFloat(style.lineHeight) * HEIGHT_LINE_MAX_CONTENT) {
      setNeedsExpansion(true)
    }
  }, [])

  return (
    props.children && (
      <div className="pt-4 pb-4 border-l pl-5 ml-3 border-chalkboard-50 ">
        <div
          className="overflow-hidden"
          style={{
            maxHeight: isExpanded ? '' : HEIGHT_LINE_MAX_CONTENT + 'lh',
          }}
        >
          <div ref={refDivChildren}>{props.children}</div>
        </div>
        {needsExpansion && (
          <ThoughtExpand
            onClick={() => setIsExpanded(!isExpanded)}
            isExpanded={isExpanded}
          />
        )}
      </div>
    )
  )
}

export const ThoughtExpand = (props: {
  isExpanded: boolean
  onClick: () => void
}) => {
  return (
    <div className="flex flex-row items-center">
      <div className="flex flex-row items-center w-full pt-4">
        <div className="mr-2 w-full border-b border-chalkboard-40 border-dashed"></div>
        <div
          className="mr-1 flex flex-row items-center cursor-pointer text-chalkboard-90"
          onClick={() => props.onClick()}
        >
          {props.isExpanded ? (
            <>
              <CustomIcon name="collapse" className="w-6 h-6" />
              <span>Collapse</span>
            </>
          ) : (
            <>
              <CustomIcon name="plus" className="w-6 h-6" />
              <span>Expand</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export const Spacer = (props: { content: string }) => {
  return (
    <ThoughtContent>
      <div></div>
    </ThoughtContent>
  )
}

export const Text = (props: { content: string }) => {
  return (
    <Thought
      heading={
        <ThoughtHeader
          icon={<CustomIcon name="ellipse1" className="w-6 h-6" />}
        >
          <Generic content={props.content} />
        </ThoughtHeader>
      }
    ></Thought>
  )
}

export const End = (props: { content: string }) => {
  return (
    <Thought>
      <ThoughtHeader icon={<CustomIcon name="ellipse1" className="w-6 h-6" />}>
        End
      </ThoughtHeader>
    </Thought>
  )
}

export const Thought = (props: {
  icon: ReactNode
  heading?: ReactNode
  children?: ReactNode
}) => {
  return (
    <div className="flex flex-col">
      {props.heading}
      {props.children}
    </div>
  )
}

interface Range {
  start: number
  end?: number
}

const DATA_TO_COMPONENT: Record<Thought['reasoning']['type'], ReactNode> = {
  text: Text,
  kcl_code_examples: KclCodeExamples,
  feature_tree_outline: FeatureTreeOutline,
  kcl_docs: KclDocs,
  generated_kcl_code: GeneratedKclCode,
  error: ErrorneousThing,
}

const Unknown = Text

export const Thinking = (props: {
  thoughts: Thought[]
  onlyShowImmediateThought: boolean
}) => {
  const refViewFull = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (props.onlyShowImmediateThought === true) {
      return
    }
    if (refViewFull.current === null) {
      return
    }
    const c = refViewFull.current.children
    if (c.length === 0) { return }
    c[c.length - 1].scrollIntoView({ behavior: 'smooth' })
  }, [props.thoughts.length])

  const componentThoughts = props.thoughts.flatMap(
    (thought: Thought, index: number) => {
      // Maybe be a tool_output
      if (thought.reasoning === undefined) return null

      let Component = DATA_TO_COMPONENT[thought.reasoning.type]
      if (!Component) {
        console.warn('Unknown type: ' + thought.reasoning.type)
        Component = Unknown
      }

      if (thought.reasoning?.type === 'generated_kcl_code') {
        return <Component key={index} code={thought.reasoning?.code} />
      }

      if (thought.reasoning?.type === 'text') {
        return [
          <Component key={index} content={thought.reasoning?.content} />,
          <Spacer />,
        ]
      }

      return <Component key={index} content={thought.reasoning?.content} />
    }
  )

  const componentLastGenericThought = (
    <Generic
      content={
        props.thoughts.findLast(
          (thought: Thought) => thought.reasoning?.type === 'text'
        )?.reasoning?.content ?? 'Processing...'
      }
    />
  )

  const ViewFull = (
    <div
      ref={refViewFull}
      className="text-chalkboard-100 rounded-md bg-chalkboard-20 pl-2 pr-2 pt-4 pb-6 border border-chalkboard-30 shadow-md"
    >
      {componentThoughts}
    </div>
  )

  const ViewImmediate = (
    <div className="animate-shimmer p-2">{componentLastGenericThought}</div>
  )

  return props.onlyShowImmediateThought ? ViewImmediate : ViewFull
}
