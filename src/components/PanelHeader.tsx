export const PanelHeader = ({ title }: { title: string }) => {
  return (
    <div className="font-mono text-[11px] bg-stone-100 w-full pl-4 h-[20px] text-stone-700 flex items-center">
      <span className="pt-1">{title}</span>
    </div>
  )
}
