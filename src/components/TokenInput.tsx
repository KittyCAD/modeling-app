import { LoginButton } from './LoginButton'

export const SetToken = () => {
  if (!(window as any).__TAURI__) {
    return <div />
  }
  return (
    <div className="w-full flex gap-2">
      <LoginButton />
    </div>
  )
}
