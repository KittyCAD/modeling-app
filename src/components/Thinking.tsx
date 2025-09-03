import ms from 'ms'

import { SafeRenderer } from '@src/lib/markdown'
import { Marked, escape, unescape } from '@ts-stack/markdown'

import { CustomIcon } from '@src/components/CustomIcon'
import { useEffect, useState, useRef, type ReactNode } from 'react'
import type { Models } from '@kittycad/lib'
import type { PlanStep_type } from '@kittycad/lib/dist/types/src/models'

export const Generic = (props: {
  content: string
}) => {
  return <div>{props.content}</div>
}

export const KclCodeExamples = (props: { content: string }) => {
  return (
    <ThoughtContainer
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
    </ThoughtContainer>
  )
}

export enum EGeneratedKclCode {
  Created = 'Created',
  Updated = 'Updated',
  Deleted = 'Deleted',
}

export const GeneratedKclCode = (props: {
  operation: EGeneratedKclCode
  code: string | undefined
  filename: string | undefined
}) => {
  return (
    <ThoughtContainer
      heading={
        <ThoughtHeader icon={<CustomIcon name="code" className="w-6 h-6" />}>
          {`${props.operation} KCL Code${props.filename ? ` (${props.filename})` : ''}`}
        </ThoughtHeader>
      }
    >
      {props.code && (
        <ThoughtContent>
          <div>
            <pre>{props.code}</pre>
          </div>
        </ThoughtContent>
      )}
    </ThoughtContainer>
  )
}

export const ErroneousThing = (props: { content: string }) => {
  return (
    <ThoughtContainer
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
    </ThoughtContainer>
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
    <ThoughtContainer
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
    </ThoughtContainer>
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
    <ThoughtContainer
      heading={
        <ThoughtHeader
          icon={<CustomIcon name="fileExplorer" className="w-6 h-6" />}
        >
          Feature tree outline
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
    </ThoughtContainer>
  )
}

export const DesignPlan = (props: { steps: PlanStep_type[] }) => {
  return (
    <ThoughtContainer
      heading={
        <ThoughtHeader
          icon={<CustomIcon name="fileExplorer" className="w-6 h-6" />}
        >
          Design Plan
        </ThoughtHeader>
      }
    >
      <ThoughtContent>
        <ul>
          {props.steps.map((step: PlanStep_type) => (
            <li>
              {step.filepath_to_edit}: {step.edit_instructions}
            </li>
          ))}
        </ul>
      </ThoughtContent>
    </ThoughtContainer>
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
    <div className="flex flex-row gap-2 text-2 font-bold items-center">
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
      <div className="pt-4 pb-4 border-l pl-5 ml-3 b-3 ">
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
        <div className="mr-2 w-full border-b b-3 border-dashed"></div>
        <div
          className="mr-1 flex flex-row items-center cursor-pointer text-2"
          role="feed"
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

export const Spacer = () => {
  return (
    <ThoughtContent>
      <div></div>
    </ThoughtContent>
  )
}

export const Text = (props: { content: string }) => {
  return (
    <ThoughtContainer
      heading={
        <ThoughtHeader
          icon={<CustomIcon name="ellipse1" className="w-6 h-6" />}
        >
          <Generic content={props.content} />
        </ThoughtHeader>
      }
    ></ThoughtContainer>
  )
}

export const End = () => {
  return (
    <ThoughtContainer>
      <ThoughtHeader icon={<CustomIcon name="ellipse1" className="w-6 h-6" />}>
        End
      </ThoughtHeader>
    </ThoughtContainer>
  )
}

export const ThoughtContainer = (props: {
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

const fromDataToComponent = (
  thought: Models['MlCopilotServerMessage_type'],
  options: { key?: string | number }
) => {
  if ('end_of_stream' in thought) {
    return <End />
  }

  if ('reasoning' in thought) {
    const type = thought.reasoning.type
    switch (type) {
      case 'text': {
        return (
          <>
            <Text key={options.key} content={thought.reasoning.content} />
            <Spacer />
          </>
        )
      }
      case 'kcl_code_examples': {
        return (
          <KclCodeExamples
            key={options.key}
            content={thought.reasoning.content}
          />
        )
      }
      case 'feature_tree_outline': {
        return (
          <FeatureTreeOutline
            key={options.key}
            content={thought.reasoning.content}
          />
        )
      }
      case 'design_plan': {
        return <DesignPlan key={options.key} steps={thought.reasoning.steps} />
      }
      case 'kcl_docs': {
        return <KclDocs key={options.key} content={thought.reasoning.content} />
      }
      case 'kcl_code_error': {
        return (
          <ErroneousThing key={options.key} content={thought.reasoning.error} />
        )
      }

      case 'generated_kcl_code': {
        return (
          <GeneratedKclCode
            key={options.key}
            operation={EGeneratedKclCode.Updated}
            filename={undefined}
            code={thought.reasoning.code}
          />
        )
      }
      case 'created_kcl_file': {
        return (
          <GeneratedKclCode
            key={options.key}
            operation={EGeneratedKclCode.Created}
            filename={thought.reasoning.file_name}
            code={thought.reasoning.content}
          />
        )
      }

      case 'updated_kcl_file': {
        return (
          <GeneratedKclCode
            key={options.key}
            operation={EGeneratedKclCode.Updated}
            filename={thought.reasoning.file_name}
            code={thought.reasoning.content}
          />
        )
      }

      case 'deleted_kcl_file': {
        return (
          <GeneratedKclCode
            key={options.key}
            operation={EGeneratedKclCode.Deleted}
            filename={thought.reasoning.file_name}
            code={undefined}
          />
        )
      }

      default:
        const _ex: never = type
    }
  }

  if ('error' in thought) {
    return <ErroneousThing key={options.key} content={thought.error.detail} />
  }

  return null
}

export const Thinking = (props: {
  thoughts?: Models['MlCopilotServerMessage_type'][]
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
    if (c.length === 0) {
      return
    }
    c[c.length - 1].scrollIntoView({ behavior: 'smooth' })
  }, [props.thoughts?.length, props.onlyShowImmediateThought])

  if (props.thoughts === undefined) {
    return (
      <div className="animate-shimmer p-2">
        <Text content={'Processing...'} />
      </div>
    )
  }

  const componentThoughts = props.thoughts.map((thought, index: number) => {
    return fromDataToComponent(thought, { key: index })
  })

  const componentLastGenericThought = (
    <Generic
      content={
        props.thoughts.findLast(
          (thought) =>
            'reasoning' in thought && thought.reasoning?.type === 'text'
          // Typescript can't figure out only a `text` type or undefined is found
          // @ts-expect-error
        )?.reasoning?.content ?? 'Processing...'
      }
    />
  )

  const ViewFull = (
    <div
      ref={refViewFull}
      className="text-2 bg-2 b-4 rounded-md pl-2 pr-2 pt-4 pb-6 border shadow-md"
    >
      {componentThoughts.length > 0 ? (
        componentThoughts
      ) : (
        <Text content={'Processing...'} />
      )}
    </div>
  )

  const ViewImmediate = (
    <div data-testid="thinking-immediate" className="animate-shimmer p-2">
      {componentLastGenericThought}
    </div>
  )

  return props.onlyShowImmediateThought ? ViewImmediate : ViewFull
}
