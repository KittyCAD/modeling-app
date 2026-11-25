import { CustomIcon } from '@src/components/CustomIcon'

export interface VisibilityToggleProps {
  label: string
  visible: boolean
  onVisibilityChange: () => unknown
}

/**
 * A button that toggles the visibility of an entity
 * tied to an artifact in the feature tree.
 */
export const VisibilityToggle = (props: VisibilityToggleProps) => {
  const label = `${props.visible ? 'Hide' : 'Show'} ${props.label}`
  return (
    <button
      onClick={props.onVisibilityChange}
      aria-label={label}
      title={label}
      aria-pressed={props.visible}
      className={`p-0 m-0 shrink-0 border-transparent focus-visible:outline focus-visible:outline-primary ${props.visible ? 'opacity-0 group-hover/visibilityToggle:opacity-100 group-focus-within/visibilityToggle:opacity-100 group-data-[selected=true]/visibilityToggle:opacity-100' : ''}`}
      data-testid="feature-tree-visibility-toggle"
    >
      <CustomIcon
        name={props.visible ? 'eyeOpen' : 'eyeCrossedOut'}
        className="w-5 h-5"
      />
    </button>
  )
}
