import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Panel — borderless "floating" surface (soft elevation instead of a hard rim).
 * Use for in-page sections/widgets where a visible border would feel heavy.
 * Card = bordered; Panel = elevation-only. Same token, two altitudes.
 */
const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-[var(--radius)] bg-card text-card-foreground p-5 shadow-[var(--shadow-card)] transition-[box-shadow,transform] duration-150 ease-out hover:shadow-[var(--shadow-pop)] hover:-translate-y-[2px]",
      className
    )}
    {...props}
  />
))
Panel.displayName = "Panel"

export { Panel }
