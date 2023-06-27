import { PropsWithChildren } from "react"

interface PanelHeaderProps extends PropsWithChildren {
  title: string
}

export const PanelHeader = ({ title, children }: PanelHeaderProps) => {
  return (
    <div className="font-mono text-[11px] bg-stone-100 w-full px-4 py-1 text-stone-700 flex items-center justify-between">
      <span>{title}</span>
      <div className="flex items-center">
        {children}
      </div>
    </div>
  )
}
