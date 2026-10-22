export const PlaceholderLine = ({
  className = '',
  ...props
}: React.HTMLAttributes<HTMLElement>) => (
  <div
    // zds-performance-exception: activity-indicator -- Keep an unpopulated loading placeholder visibly active while its data is pending; replacement content is not delayed.
    className={`animate-pulse animate-shimmer h-2 w-full bg-chalkboard-40 rounded ${className}`}
    {...props}
  ></div>
)
