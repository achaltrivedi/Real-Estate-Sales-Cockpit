import type { ButtonHTMLAttributes, ReactNode } from 'react';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  return (
    <button
      className={cx(
        'rounded-pill px-5 py-2.5 text-sm font-medium transition disabled:opacity-50',
        variant === 'primary' ? 'bg-brand text-white hover:bg-brand-dark' : 'border border-ink/15 text-ink hover:bg-ink/5',
        className,
      )}
      {...props}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-card bg-white p-6 shadow-sm ring-1 ring-ink/5', className)}>{children}</div>;
}

/** Demo-day rule: every screen shows that the data is fictional. */
export function SampleDataBanner({ text }: { text: string }) {
  return (
    <div role="note" className="w-full bg-gold/90 px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-ink">
      {text}
    </div>
  );
}

export function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-medium" style={{ background: `${color}1A`, color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}
