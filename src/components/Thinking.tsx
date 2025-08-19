import { SafeRenderer } from '@src/lib/markdown'
import { Marked, escape, unescape } from '@ts-stack/markdown'

import { CustomIcon } from '@src/components/CustomIcon'
import { useEffect, useState, useRef, type ReactNode } from 'react'

export const Generic = (props: {
  text: string
}) => {
  return <div>
    { props.text }
  </div>
}

export const KclSample = (props: {
  text: string
}) => {
  return <div>
    <pre>
      { props.text }
    </pre>
  </div>
}

export const KclGenerated = (props: {
  text: string
}) => {
  return <div>
    <pre>
      { props.text }
    </pre>
  </div>
}

export const ErrorneousThing = (props: {
  text: string
}) => {
  return <div>
    { props.text }
  </div>
}

export const Documentation = (props: {
  content: string
}) => {
  const options =  {
    gfm: true,
    breaks: true,
    sanitize: true,
    escape,
    unescape
  }
  return <div
    dangerouslySetInnerHTML={{
      __html: Marked.parse(props.content, {
        renderer: new SafeRenderer(options),
        ...options,
      }),
    }}>
  </div>
}

export const DesignPlan = (props: {
  content: string
}) => {
  const options =  {
    gfm: true,
    breaks: true,
    sanitize: true,
    unescape,
    escape,
  }
  return <div
    dangerouslySetInnerHTML={{
      __html: Marked.parse(props.content, {
        renderer: new SafeRenderer(options),
        ...options,
      }),
    }}>
  </div>
}

export const ThoughtFor = (props: {
  start: number
}) => {
  return <div>
    Worked for { ms(props.start - Date.now(), { long: true }) }
  </div>
}

export const ThoughtHeader = (props: {
  icon: ReactNode,
  children?: ReactNode,
}) => {
  return <div className="flex flex-row gap-2 text-chalkboard-70 font-bold items-center">
    <div className="flex justify-center items-center">
      { props.icon }
    </div>
    <div className="w-full">
      { props.children }
    </div>
  </div>
}

const HEIGHT_LINE_MAX_CONTENT = 4

export const ThoughtContent = (props: { children?: ReactNode }) => {
  const [needsExpansion, setNeedsExpansion] = useState<boolean>(false)
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const refDivChildren = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (refDivChildren.current === null) { return }
    const bb = refDivChildren.current.getBoundingClientRect()
    const style = getComputedStyle(refDivChildren.current)
    if (bb.height > (parseFloat(style.lineHeight) * HEIGHT_LINE_MAX_CONTENT)) {
      setNeedsExpansion(true)
    }
  }, [])

  return props.children && <div>
      <div className="pt-4 pb-4 border-l border-chalkboard-50 pl-5 ml-3 overflow-hidden" style={{ maxHeight: isExpanded ? '' : HEIGHT_LINE_MAX_CONTENT + 'lh' }}>
        <div ref={refDivChildren}>
          { props.children }
        </div>
      </div>
      { needsExpansion && <ThoughtExpand onClick={() => setIsExpanded(!isExpanded)} isExpanded={isExpanded} /> }
    </div>
}

export const ThoughtExpand = (props: { isExpanded: boolean, onClick: () => void }) => {
  return <div className="flex flex-row pl-3 items-center">
    <div className="self-stretch border-l border-chalkboard-50"></div>
    <div className="flex flex-row items-center w-full pb-4">
      <div className="ml-5 mr-2 w-full border-b border-chalkboard-40 border-dashed"></div>
      <div className="mr-1 flex flex-row items-center cursor-pointer text-chalkboard-90" onClick={() => props.onClick()}>
      { props.isExpanded
        ? <><CustomIcon name="collapse" className="w-6 h-6" /><span>Collapse</span></>
        : <><CustomIcon name="plus" className="w-6 h-6" /><span>Expand</span></>
      }
      </div>
    </div>
  </div>
}

export const Thought = (props: {
  icon: ReactNode,
  heading?: ReactNode,
  children?: ReactNode,
}) => {
  return <div className="flex flex-col">
    <ThoughtHeader icon={props.icon}>{ props.heading }</ThoughtHeader>
    <ThoughtContent>
      { props.children }
    </ThoughtContent>
  </div>
}

interface Range {
  start: number
  end?: number
}

export const Thinking = (props: {
  thoughts: Thought[]
  onlyShowImmediateThought: boolean
}) => {
  const code = `
  countersunk-plate.kcl
  // Plate with countersunk holes
  // A small mounting plate with a countersunk hole at each end
  Set units
  @settings(defaultLengthUnit = in)
  Define parameters
  boltSpacing = 5
  boltDiameter = 1 / 4
  `
  const componentThoughts = [
    <Thought icon={<CustomIcon name="fileExplorer" className="w-6 h-6"/>} heading={"Design Plan"}>
      <DesignPlan content={
        `
# hi

1. do this
2. do that
3. ???
4. profit

\`\`\`\`js
const x = 31
\`\`\`\`

`
      } />
    </Thought>,
    <Thought icon={<CustomIcon name="folderOpen" className="w-6 h-6"/>} heading={"Documentation"}>
      <Documentation content={'# yes ok'} />
    </Thought>,
    <Thought icon={<CustomIcon name="code" className="w-6 h-6"/>} heading={"Generated KCL Code"}>
      <KclGenerated text={code} />
    </Thought>,
    <Thought icon={<CustomIcon name="ellipse1" className="w-6 h-6"/>} heading={
      <Generic text={'📝 Generating a design plan...'} />
    }>
      <div></div>
    </Thought>,
    <Thought icon={<CustomIcon name="triangleExclamation" className="w-6 h-6"/>} heading={"Error detected"}>
      <ErrorneousThing text={'KCL syntax error blahbla hla blahu'} />
    </Thought>,
    <Thought icon={<CustomIcon name="file" className="w-6 h-6"/>} heading={"KCL Sample"}>
      <KclSample text={code} />
    </Thought>,
    <Thought icon={<CustomIcon name="checkmark" className="w-6 h-6"/>} heading={"Success"}>
    </Thought>,
  ]

  const componentLastGenericThought = <Generic text={'📝 Generating a design plan...'} />

  const ViewFull = (
    <div className="text-chalkboard-100 rounded-md bg-chalkboard-20 p-2 pb-6 border border-chalkboard-30 shadow-md">
      { componentThoughts }
    </div>
  )

  const ViewImmediate = (
    <div className="animate-shimmer p-2">
      { componentLastGenericThought }
    </div>
  )

  return props.onlyShowImmediateThought ? ViewImmediate : ViewFull
}
