export const PanelHeader = ({ title }: { title: string }) => {
  return (
    <div className="font-mono text-[11px] bg-chalkboard-20 dark:bg-chalkboard-110 dark:border-b-2 dark:border-b-chalkboard-90 w-full pl-4 h-[20px] flex items-center">
      <span className="pt-1">{title}</span>
    </div>
  )
}
