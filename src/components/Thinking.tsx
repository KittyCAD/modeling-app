import ms from 'ms'

import type { MlCopilotServerMessage, MlCopilotFile } from '@kittycad/lib'
import type { PlanStep } from '@kittycad/lib'
import { CustomIcon } from '@src/components/CustomIcon'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { PlaceholderLine } from '@src/components/PlaceholderLine'
import { MarkdownText } from '@src/components/MarkdownText'

interface IRowCollapse {
  fn: () => void
  keyIndex: number
}

export const Generic = (props: {
  content: string
}) => {
  return <div>{props.content}</div>
}

export const KclCodeExamples = (props: {
  content: string
  setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
  keyIndex: number
}) => {
  return (
    <ThoughtContainer
      heading={
        <ThoughtHeader icon={<CustomIcon name="file" className="w-6 h-6" />}>
          KCL Sample
        </ThoughtHeader>
      }
    >
      <ThoughtContent
        keyIndex={props.keyIndex}
        setAnyRowCollapse={props.setAnyRowCollapse}
      >
        <pre className="overflow-x-auto">{props.content}</pre>
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
  setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
  keyIndex: number
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
        <ThoughtContent
          keyIndex={props.keyIndex}
          setAnyRowCollapse={props.setAnyRowCollapse}
        >
          <pre className="overflow-x-auto">{props.code}</pre>
        </ThoughtContent>
      )}
    </ThoughtContainer>
  )
}

export const ErroneousThing = (props: {
  content: string
  setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
  keyIndex: number
}) => {
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
      <ThoughtContent
        keyIndex={props.keyIndex}
        setAnyRowCollapse={props.setAnyRowCollapse}
      >
        <pre className="overflow-x-auto">{props.content}</pre>
      </ThoughtContent>
    </ThoughtContainer>
  )
}

export const KclDocs = (props: {
  content: string
  setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
  keyIndex: number
}) => {
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
      <ThoughtContent
        keyIndex={props.keyIndex}
        setAnyRowCollapse={props.setAnyRowCollapse}
      >
        <MarkdownText text={props.content} />
      </ThoughtContent>
    </ThoughtContainer>
  )
}

export const FeatureTreeOutline = (props: {
  content: string
  setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
  keyIndex: number
}) => {
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
      <ThoughtContent
        keyIndex={props.keyIndex}
        setAnyRowCollapse={props.setAnyRowCollapse}
      >
        <MarkdownText text={props.content} />
      </ThoughtContent>
    </ThoughtContainer>
  )
}

export const DesignPlan = (props: {
  steps: PlanStep[]
  setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
  keyIndex: number
}) => {
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
      <ThoughtContent
        keyIndex={props.keyIndex}
        setAnyRowCollapse={props.setAnyRowCollapse}
      >
        <ul>
          {props.steps.map((step: PlanStep) => (
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

export const ThoughtContent = (props: {
  children?: ReactNode
  setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
  keyIndex: number
}) => {
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
      <div className="pt-4 pb-4 border-l pl-5 ml-3 b-3">
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
            onClick={() => {
              setIsExpanded(!isExpanded)
              props.setAnyRowCollapse((state) => {
                let copied = [...state]
                if (isExpanded) {
                  copied = copied.filter(
                    (row) => row.keyIndex !== props.keyIndex
                  )
                } else {
                  copied.push({
                    fn: () => {
                      setIsExpanded(false)
                    },
                    keyIndex: props.keyIndex,
                  })
                }
                return copied
              })
            }}
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

export const Spacer = (props: {
  setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
  keyIndex: number
}) => {
  return (
    <ThoughtContent
      keyIndex={props.keyIndex}
      setAnyRowCollapse={props.setAnyRowCollapse}
    >
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

export const NothingInParticular = (props: {
  content: string
  setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
  keyIndex: number
}) => {
  return (
    <ThoughtContainer
      heading={
        <ThoughtHeader icon={<CustomIcon name="brain" className="w-6 h-6" />}>
          <span>Thinking</span>
        </ThoughtHeader>
      }
    >
      <ThoughtContent
        keyIndex={props.keyIndex}
        setAnyRowCollapse={props.setAnyRowCollapse}
      >
        <MarkdownText text={props.content} />
      </ThoughtContent>
    </ThoughtContainer>
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

/**
 * Convert a byte array to a data URL for displaying images/files
 */
const bytesToDataUrl = (data: number[], mimetype: string): string => {
  const uint8Array = new Uint8Array(data)
  const blob = new Blob([uint8Array], { type: mimetype })
  return URL.createObjectURL(blob)
}

/**
 * Check if a mimetype is an image type
 */
const isImageMimetype = (mimetype: string): boolean => {
  return mimetype.startsWith('image/')
}

/**
 * Component for displaying an image file with error handling
 */
const ImageFileItem = (props: {
  file: MlCopilotFile
  url: string | undefined
  onDownload: (url: string, filename: string) => void
}) => {
  const [imageError, setImageError] = useState(false)

  if (!props.url || imageError) {
    // Fallback to file icon if image fails to load
    return (
      <button
        onClick={() =>
          props.url && props.onDownload(props.url, props.file.name)
        }
        className="flex flex-row gap-2 items-center cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-90 p-2 rounded transition-colors text-left w-full"
        title={`Click to download ${props.file.name}`}
      >
        <CustomIcon name="file" className="w-5 h-5 flex-shrink-0" />
        <span className="text-sm truncate">{props.file.name}</span>
        <CustomIcon name="download" className="w-4 h-4 ml-auto flex-shrink-0" />
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-chalkboard-70 dark:text-chalkboard-40">
        {props.file.name}
      </span>
      <button
        onClick={() => props.onDownload(props.url!, props.file.name)}
        className="cursor-pointer hover:opacity-80 transition-opacity text-left"
        title={`Click to download ${props.file.name}`}
      >
        <img
          src={props.url}
          alt={props.file.name}
          className="max-w-full h-auto rounded border border-chalkboard-30 dark:border-chalkboard-80"
          onError={() => setImageError(true)}
        />
      </button>
    </div>
  )
}

export const FilesSnapshot = (props: {
  files: MlCopilotFile[]
}) => {
  const [objectUrls, setObjectUrls] = useState<string[]>([])

  useEffect(() => {
    // Create object URLs for all files
    const urls = props.files.map((file) =>
      bytesToDataUrl(file.data, file.mimetype)
    )
    setObjectUrls(urls)

    // Cleanup object URLs when component unmounts
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [props.files])

  const handleDownload = (url: string, filename: string) => {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const imageFiles = props.files.filter((file) =>
    isImageMimetype(file.mimetype)
  )
  const otherFiles = props.files.filter(
    (file) => !isImageMimetype(file.mimetype)
  )

  return (
    <ThoughtContainer
      heading={
        <ThoughtHeader icon={<CustomIcon name="file" className="w-6 h-6" />}>
          {props.files.length === 1
            ? 'Zookeeper File'
            : `Zookeeper Files (${props.files.length})`}
        </ThoughtHeader>
      }
    >
      {/* Using a custom content wrapper without height restriction for images */}
      <div className="pt-4 pb-4 border-l pl-5 ml-3 b-3">
        <div className="flex flex-col gap-3">
          {imageFiles.map((file, index) => {
            const fileIndex = props.files.indexOf(file)
            const url = objectUrls[fileIndex]
            return (
              <ImageFileItem
                key={index}
                file={file}
                url={url}
                onDownload={handleDownload}
              />
            )
          })}
          {otherFiles.map((file, index) => {
            const fileIndex = props.files.indexOf(file)
            const url = objectUrls[fileIndex]
            return (
              <button
                key={`other-${index}`}
                onClick={() => url && handleDownload(url, file.name)}
                className="flex flex-row gap-2 items-center cursor-pointer hover:bg-chalkboard-20 dark:hover:bg-chalkboard-90 p-2 rounded transition-colors text-left w-full"
                title={`Click to download ${file.name}`}
              >
                <CustomIcon name="file" className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm truncate">{file.name}</span>
                <CustomIcon
                  name="download"
                  className="w-4 h-4 ml-auto flex-shrink-0"
                />
              </button>
            )
          })}
        </div>
      </div>
    </ThoughtContainer>
  )
}

interface Range {
  start: number
  end?: number
}

const fromDataToComponent = (
  thought: MlCopilotServerMessage,
  options: {
    key?: string | number
    setAnyRowCollapse: React.Dispatch<React.SetStateAction<IRowCollapse[]>>
    keyIndex: number
  }
) => {
  if ('reasoning' in thought) {
    const type = thought.reasoning.type
    switch (type) {
      case 'text': {
        return (
          <div key={options.key}>
            <Text content={thought.reasoning.content} />
            <Spacer
              setAnyRowCollapse={options.setAnyRowCollapse}
              keyIndex={options.keyIndex}
            />
          </div>
        )
      }
      case 'markdown': {
        return (
          <NothingInParticular
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
            key={options.key}
            content={(thought.reasoning as { content: string }).content}
          />
        )
      }
      case 'kcl_code_examples': {
        return (
          <KclCodeExamples
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
            key={options.key}
            content={thought.reasoning.content}
          />
        )
      }
      case 'feature_tree_outline': {
        return (
          <FeatureTreeOutline
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
            key={options.key}
            content={thought.reasoning.content}
          />
        )
      }
      case 'design_plan': {
        return (
          <DesignPlan
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
            key={options.key}
            steps={thought.reasoning.steps}
          />
        )
      }
      case 'kcl_docs': {
        return (
          <KclDocs
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
            key={options.key}
            content={thought.reasoning.content}
          />
        )
      }
      case 'kcl_code_error': {
        return (
          <ErroneousThing
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
            key={options.key}
            content={thought.reasoning.error}
          />
        )
      }

      case 'generated_kcl_code': {
        return (
          <GeneratedKclCode
            key={options.key}
            operation={EGeneratedKclCode.Updated}
            filename={undefined}
            code={thought.reasoning.code}
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
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
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
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
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
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
            setAnyRowCollapse={options.setAnyRowCollapse}
            keyIndex={options.keyIndex}
          />
        )
      }

      default:
        const _ex: never = type
    }
  }

  if ('files' in thought) {
    return <FilesSnapshot key={options.key} files={thought.files.files} />
  }

  return null
}

export const Thinking = (props: {
  thoughts?: MlCopilotServerMessage[]
  isDone: boolean
  onlyShowImmediateThought: boolean
}) => {
  const refViewFull = useRef<HTMLDivElement>(null)
  const isProgrammaticScrollRef = useRef(false)
  const userHasInteractedWithPaneRef = useRef(false)
  const [userHasManuallyScrolled, setUserHasManuallyScrolled] = useState(false)
  const [anyRowCollapse, setAnyRowCollapse] = useState<IRowCollapse[]>([])
  const collapseAndClearAllRows = useCallback(() => {
    anyRowCollapse.forEach((row) => {
      row.fn()
    })
    setAnyRowCollapse([])
  }, [anyRowCollapse])

  const reasoningThoughts =
    props.thoughts?.filter((x: MlCopilotServerMessage) => {
      return 'reasoning' in x || 'files' in x
    }) ?? []

  // Resume reasoning autoscroll when a new prompt is sent
  useEffect(() => {
    if (reasoningThoughts.length === 0) {
      userHasInteractedWithPaneRef.current = false
      setUserHasManuallyScrolled(false)
    }
  }, [reasoningThoughts.length])

  const onReasoningPaneInteraction = useCallback(() => {
    isProgrammaticScrollRef.current = false
    userHasInteractedWithPaneRef.current = true
  }, [])

  const onReasoningScroll = useCallback(() => {
    const el = refViewFull.current
    if (!el) return

    if (isProgrammaticScrollRef.current) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4
      if (atBottom) {
        isProgrammaticScrollRef.current = false
      }
      return
    }
    // Show the scrollbar after user has manually scrolled
    if (userHasInteractedWithPaneRef.current) {
      setUserHasManuallyScrolled(true)
    }
  }, [])

  useEffect(() => {
    if (props.onlyShowImmediateThought === true || userHasManuallyScrolled) {
      return
    }

    // Autoscroll to the bottom until the user manually scrolls
    requestAnimationFrame(() => {
      if (refViewFull.current === null) {
        return
      }

      isProgrammaticScrollRef.current = true
      refViewFull.current.scrollTo({
        top: refViewFull.current.scrollHeight,
        behavior: 'smooth',
      })
    })
  }, [
    reasoningThoughts.length,
    props.onlyShowImmediateThought,
    userHasManuallyScrolled,
  ])

  if (props.thoughts === undefined) {
    return (
      <div className="animate-shimmer p-2">
        <Generic content={'Thinking...'} />
      </div>
    )
  }

  const componentThoughts = reasoningThoughts.map((thought, index: number) => {
    return fromDataToComponent(thought, {
      key: index,
      setAnyRowCollapse,
      keyIndex: index,
    })
  })

  if (props.isDone) {
    componentThoughts.push(<End key={reasoningThoughts.length} />)
  }

  const lastTextualThought = reasoningThoughts.findLast(
    (thought) => 'reasoning' in thought && thought.reasoning.type === 'text'
  )

  const componentLastGenericThought = (
    <Generic
      content={
        lastTextualThought !== undefined &&
        'reasoning' in lastTextualThought &&
        lastTextualThought.reasoning.type === 'text'
          ? lastTextualThought.reasoning.content
          : ''
      }
    />
  )

  const ViewFull = (
    <div
      data-testid="ml-response-thinking-view"
      ref={refViewFull}
      role="region"
      style={{ maxHeight: '20lh' }}
      className={`relative select-text overflow-auto text-2 text-xs bg-1 b-4 rounded-md pl-2 pr-2 pt-4 pb-6 border shadow-md ${!userHasManuallyScrolled ? 'scrollbar-hide' : ''}`}
      onScroll={onReasoningScroll}
      onWheel={onReasoningPaneInteraction}
      onTouchStart={onReasoningPaneInteraction}
      onPointerDown={onReasoningPaneInteraction}
      onKeyDown={onReasoningPaneInteraction}
    >
      {componentThoughts.length > 0 ? componentThoughts : <PlaceholderLine />}
      {anyRowCollapse.length > 0 && (
        <button
          className="absolute flex justify-center items-center flex-none bottom-8 right-3 bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 "
          onClick={collapseAndClearAllRows}
        >
          Collapse all
        </button>
      )}
    </div>
  )

  const ViewImmediate = (
    <div data-testid="thinking-immediate" className="animate-shimmer p-2 pb-4">
      {componentLastGenericThought}
    </div>
  )

  return props.onlyShowImmediateThought ? ViewImmediate : ViewFull
}
