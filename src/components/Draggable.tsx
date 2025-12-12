import { MouseMove } from '@rust/kcl-lib/bindings/ModelingCmd'
import {
  DragEventHandler,
  HTMLProps,
  MouseEventHandler,
  PropsWithChildren,
  RefObject,
  useRef,
  useState,
} from 'react'

interface DraggableProps extends PropsWithChildren {
  boundingElement: RefObject<HTMLElement>
  elementProps: HTMLProps<HTMLDivElement>
}

type Position = Partial<{
  top: number
  right: number
  bottom: number
  left: number
}>

const initialPosition = (): Position => ({
  top: 10,
  right: 10,
})

export function Draggable(props: DraggableProps) {
  const targetRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const [position, setPosition] = useState<Position>(initialPosition())

  const handleDrag: MouseEventHandler = (e) => {
    if (!isDragging) return
    const pos = e.currentTarget.getBoundingClientRect()
    const bounding = (props.boundingElement?.current ?? window.document.body)
      .getBoundingClientRect

    console.log('dragging', { pos, bounding, e })

    if (targetRef.current) {
      targetRef.current.style.top = `${e.pageX - pos.width / 2}px`
      targetRef.current.style.left = `${e.pageY - pos.height / 2}px`
    }
  }

  return (
    <div
      ref={targetRef}
      onMouseDown={() => setIsDragging(true)}
      onMouseUp={() => setIsDragging(false)}
      onMouseMove={handleDrag}
      {...props.elementProps}
      style={{ ...props.elementProps.style, position: 'fixed' }}
    >
      {props.children}
    </div>
  )
}
