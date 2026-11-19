import { ActionButton } from '@src/components/ActionButton'

export function CloudLibraryCreateButton({
  className,
  onClick,
}: {
  className: string
  onClick: () => void
}) {
  return (
    <ActionButton
      Element="button"
      className={className}
      onClick={onClick}
      iconStart={{ icon: 'folderPlus', bgClassName: '!bg-transparent' }}
    >
      New cloud library
    </ActionButton>
  )
}
