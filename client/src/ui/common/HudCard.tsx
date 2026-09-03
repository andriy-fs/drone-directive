import type { ReactNode } from 'react';
import type { LucideIcon } from './icons';

/**
 * A titled panel in the HUD sidebar: an icon + uppercase caption over a hairline,
 * then the section's content. Every section in the sidebar is one of these — the
 * plain top-border heading they were converted from (`hud__section`) is gone, so
 * a new section goes here rather than inventing chrome of its own.
 */
export function HudCard({
  icon: Icon,
  title,
  action,
  className = '',
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Optional control pinned to the right of the header — a help button, say. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`hud-card ${className}`.trim()}>
      <header className="hud-card__header">
        <Icon size={13} />
        <h2 className="hud-card__title">{title}</h2>
        {action && <div className="hud-card__action">{action}</div>}
      </header>
      <div className="hud-card__body">{children}</div>
    </section>
  );
}
