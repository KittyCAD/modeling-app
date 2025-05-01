import {
  BillingRemaining,
  BillingRemainingMode,
} from '@src/components/BillingRemaining'

export const BillingDialog = () => {
  return (
    <div
      className="flex flex-row rounded-lg p-2"
      style={{ backgroundColor: '#29FFA4', color: 'black' }}
    >
      <div>Star icon</div>
      <div className="flex flex-col gap-2">
        <div className="font-bold font-lg">Upgrade your plan</div>
        <div className="text-chalkboard-50">
          for unlimited usage of Text-to-CAD and more!
        </div>
        <BillingRemaining mode={BillingRemainingMode.ProgressBarStretch} />
        <div
          className="rounded-lg text-center p-1 cursor-pointer"
          style={{ backgroundColor: 'black', color: 'white' }}
        >
          Upgrade
        </div>
      </div>
    </div>
  )
}
