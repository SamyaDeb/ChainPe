import type { ReactNode } from "react";

/** The landing page's layout system. Every section uses these, so edges and spacing line up. */
export const CONTAINER = "max-w-[1400px] mx-auto px-6 lg:px-12";
export const SECTION = "relative py-20 lg:py-28";
/** Two-column sections all split at the same line. */
export const SPLIT = "grid lg:grid-cols-2 gap-12 lg:gap-24";

export function SectionHeader({
  eyebrow,
  title,
  muted,
  description,
  inverted = false,
  className = "mb-12 lg:mb-16",
}: {
  eyebrow: string;
  title: ReactNode;
  muted?: ReactNode;
  description?: ReactNode;
  inverted?: boolean;
  className?: string;
}) {
  const soft = inverted ? "text-background/60" : "text-muted-foreground";

  return (
    <header className={className}>
      <span className={`flex items-center gap-3 text-sm font-mono mb-6 ${soft}`}>
        <span className={`w-8 h-px ${inverted ? "bg-background/30" : "bg-foreground/30"}`} />
        {eyebrow}
      </span>
      <h2 className="text-4xl lg:text-6xl font-display tracking-tight">
        {title}
        {muted ? <span className={`block ${soft}`}>{muted}</span> : null}
      </h2>
      {description ? (
        <p className={`mt-6 text-lg lg:text-xl leading-relaxed max-w-2xl ${soft}`}>{description}</p>
      ) : null}
    </header>
  );
}

/**
 * Stacks every item in one grid cell and shows the active one, so the box is always as
 * tall as its tallest item and doesn't jump when the content changes.
 */
export function CodeStack({
  items,
  active,
  lineClassName = "",
}: {
  items: string[];
  active: number;
  lineClassName?: string;
}) {
  return (
    <div className="grid min-w-0 w-full">
      {items.map((code, index) => (
        <pre
          key={index}
          className={`col-start-1 row-start-1 min-w-0 overflow-x-auto font-mono text-sm leading-loose ${lineClassName} ${
            index === active ? "" : "invisible"
          }`}
        >
          <code>{code}</code>
        </pre>
      ))}
    </div>
  );
}
