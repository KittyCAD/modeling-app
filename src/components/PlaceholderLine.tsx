export const PlaceholderLine = ({
  className = '',
  ...props
}: React.HTMLAttributes<HTMLElement>) => (
  <div
    className={`animate-pulse animate-shimmer h-2 w-full bg-chalkboard-40 rounded ${className}`}
    {...props}
  ></div>
)
