/** A horizontal progress/fill bar. `value` is clamped to 0..1. */
export function Bar({ value, className = '' }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`bar ${className}`.trim()}>
      <div className="bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
