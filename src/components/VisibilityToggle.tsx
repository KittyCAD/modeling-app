import { CustomIcon } from '@src/components/CustomIcon'

export interface VisibilityToggleProps {
  visible: boolean
  onVisibilityChange: () => unknown
}

/**
 * A button that toggles the visibility of an entity
 * tied to an artifact in the feature tree.
 * For now just used for default planes.
 */
export const VisibilityToggle = (props: VisibilityToggleProps) => {
  return (
    <button
      onClick={props.onVisibilityChange}
      className={`p-0 m-0 border-transparent ${props.visible ? 'invisible hover:visible group-hover/visibilityToggle:visible focus-visible:visible group-focus-visible/visibilityToggle:visible' : ''}`}
      data-testid="feature-tree-visibility-toggle"
    >
      <CustomIcon
        name={props.visible ? 'eyeOpen' : 'eyeCrossedOut'}
        className="w-5 h-5"
      />
    </button>
  )
}
