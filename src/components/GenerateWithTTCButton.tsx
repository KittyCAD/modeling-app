import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { ML_EXPERIMENTAL_MESSAGE } from '@src/lib/constants'
import Tooltip from '@src/components/Tooltip'

export const GenerateWithTTCButton = (props: {
  hasBorder?: true
  onClick: (prompt: string) => void
}) => {
  const sidebarButtonClasses = `${props.hasBorder ? 'border' : 'border-transparent'} flex items-center p-2 gap-2 leading-tight dark:border-transparent enabled:dark:border-transparent enabled:hover:border-primary/50 enabled:dark:hover:border-inherit active:border-primary dark:bg-transparent hover:bg-transparent`

  return (
    <ActionButton
      Element="button"
      onClick={() => props.onClick}
      className={sidebarButtonClasses}
      iconStart={{
        icon: 'sparkles',
        bgClassName: '!bg-transparent rounded-sm',
      }}
      data-testid="home-text-to-cad"
    >
      Generate with Text-to-CAD
      <Tooltip position="bottom-left">
        <div className="text-sm flex flex-col max-w-xs">
          <div className="text-xs flex justify-center item-center gap-1 pb-1 border-b border-chalkboard-50">
            <CustomIcon name="beaker" className="w-4 h-4" />
            <span>Experimental</span>
          </div>
          <p className="pt-2 text-left">{ML_EXPERIMENTAL_MESSAGE}</p>
        </div>
      </Tooltip>
    </ActionButton>
  )
}
