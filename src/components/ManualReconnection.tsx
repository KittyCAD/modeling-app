import { ActionButton } from '@src/components/ActionButton'

export const ManualReconnection = ({
  callback,
  className,
}: { callback: () => void; className: string }) => {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div className="rounded-sm border border-solid flex flex-col items-center p-4 border-chalkboard-20 dark:border-chalkboard-80 bg-chalkboard-10 dark:bg-chalkboard-90">
      <p>Something went wrong while connecting</p>
      <ActionButton
    className="py-2 px mt-2 hover:bg-primary/10 dark:hover:bg-chalkboard-70"
        Element="button"
        onClick={() => callback()}
      >
        reconnect
      </ActionButton>
      </div>
    </div>
  )
}
