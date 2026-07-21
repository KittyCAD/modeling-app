const DEFAULT_DRAG_PREVIEW_CLASS_NAMES = [
  'text-xs',
  'py-1',
  'px-2',
  'rounded-full',
  'border-primary',
  'border',
  'bg-default',
] as const

interface DragPreviewOptions {
  id: string
  text: string
  classNames?: readonly string[]
  offsetX?: number
  offsetY?: number
}

export function removeDragPreviewElement(id: string) {
  if (typeof document === 'undefined') {
    return
  }

  document.getElementById(id)?.remove()
}

export function createDragPreviewElement({
  id,
  text,
  classNames = DEFAULT_DRAG_PREVIEW_CLASS_NAMES,
}: DragPreviewOptions) {
  if (typeof document === 'undefined') {
    return undefined
  }

  removeDragPreviewElement(id)

  const element = document.createElement('div')
  element.id = id
  element.classList.add(...classNames)
  element.style.position = 'fixed'
  element.style.top = '-1000px'
  element.style.left = '-1000px'
  element.style.pointerEvents = 'none'
  element.textContent = text
  document.body.appendChild(element)
  return element
}

export function setDragPreview(
  dataTransfer: DataTransfer,
  { offsetX = 0, offsetY = 0, ...options }: DragPreviewOptions
) {
  const element = createDragPreviewElement(options)
  if (!element) {
    return
  }

  dataTransfer.setDragImage(element, offsetX, offsetY)
  return element
}
