export const PanelHeader = ({ title }: { title: string }) => {
  return (
    <div className="font-mono text-xs bg-stone-100 w-full pl-4 h-[30px] text-stone-700 flex items-center">
      {title}
    </div>
  )
}
