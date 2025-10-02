import { ActionButton } from '@src/components/ActionButton'

export const ManualReconnection = ({
  callback,
  className,
}: { callback: () => void; className: string }) => {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <p>Something went wrong while connecting</p>
      <ActionButton
        className="py-2 px"
        Element="button"
        onClick={() => callback()}
      >
        reconnect
      </ActionButton>
    </div>
  )
}
