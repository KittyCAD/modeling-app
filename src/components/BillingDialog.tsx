import { CustomIcon } from '@src/components/CustomIcon'
import {
  BillingRemaining,
  BillingRemainingMode,
} from '@src/components/BillingRemaining'

export type BillingDialogProps = {
  error?: Error
  credits?: number
  allowance?: number
  upgradeHref: string
  upgradeClick?: React.MouseEventHandler<HTMLAnchorElement>
}

export const BillingDialog = (props: BillingDialogProps) => {
  const hasUnlimited = props.credits === Infinity

  return (
    <div className="bg-ml-green fg-ml-black flex flex-row rounded-lg p-4 gap-2 text-xs">
      <div>
        <div className="rounded bg-ml-black p-1">
          {hasUnlimited ? (
            <CustomIcon name="infinity" className="!text-ml-white w-5 h-5" />
          ) : (
            <CustomIcon name="star" className="!text-ml-white w-5 h-5" />
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="font-bold text-ml-black h-5 py-1">
          {hasUnlimited ? 'Unlimited Text-to-CAD' : 'Upgrade your plan'}
        </div>
        <div className="text-ml-grey">
          {hasUnlimited
            ? 'You have unlimited use on your paid plan.'
            : 'for unlimited usage of Text-to-CAD and more!'}
        </div>
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarStretch}
          error={props.error}
          credits={props.credits}
          allowance={props.allowance}
        />
        {!hasUnlimited && (
          <a
            className="bg-ml-black text-ml-white rounded-lg text-center p-1 cursor-pointer"
            href={props.upgradeHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="billing-upgrade-button"
            onClick={props.upgradeClick}
          >
            Upgrade
          </a>
        )}
      </div>
    </div>
  )
}
