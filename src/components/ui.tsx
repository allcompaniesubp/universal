/**
 * Shared presentational components.
 *
 * Kept in one module because they are small and always used together. The
 * verification and status components encode the platform's honesty rules, so
 * they live here rather than being re-implemented per page.
 */

import type { ReactNode } from 'react';
import type { VerificationEntry } from '../lib/api.ts';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-800 disabled:bg-navy-300',
  secondary: 'bg-white text-navy-900 ring-1 ring-navy-200 hover:bg-navy-50 disabled:text-navy-300',
  ghost: 'text-navy-700 hover:bg-navy-50 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300',
};

export function Button({
  children,
  tone = 'primary',
  type = 'button',
  disabled,
  onClick,
  className = '',
  fullWidth,
}: {
  children: ReactNode;
  tone?: ButtonTone;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  fullWidth?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${BUTTON_TONES[tone]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
    good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200',
    bad: 'bg-red-50 text-red-800 ring-red-200',
    info: 'bg-navy-50 text-navy-800 ring-navy-200',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }> = {
    published: { label: 'Published', tone: 'good' },
    draft: { label: 'Draft', tone: 'neutral' },
    unpublished: { label: 'Unpublished', tone: 'warn' },
    suspended: { label: 'Suspended', tone: 'bad' },
  };
  const entry = map[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">
        {label}
        {required && <span className="text-red-700"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-navy-500 focus:ring-1 focus:ring-navy-500';

export function Alert({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'border-navy-200 bg-navy-50 text-navy-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
  } as const;
  const roles = { info: 'status', success: 'status', warning: 'alert', error: 'alert' } as const;

  return (
    <div role={roles[tone]} className={`rounded-lg border p-3.5 text-sm ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-slate-500">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-navy-700"
      />
      <span>{label}…</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Renders one verification level.
 *
 * An unperformed check is shown explicitly as "Not checked yet" rather than
 * being hidden or greyed into ambiguity, so a reader can tell the difference
 * between "not verified" and "we have not looked".
 */
export function VerificationRow({ entry }: { entry: VerificationEntry }) {
  const tone: 'good' | 'neutral' | 'warn' | 'bad' =
    entry.status === 'verified' && entry.held
      ? 'good'
      : entry.status === 'pending'
        ? 'warn'
        : entry.status === 'rejected' || entry.status === 'revoked'
          ? 'bad'
          : entry.status === 'expired'
            ? 'warn'
            : 'neutral';

  const label =
    entry.status === 'not_started'
      ? 'Not checked yet'
      : entry.status === 'verified' && !entry.held
        ? 'Expired'
        : entry.status === 'verified'
          ? 'Verified'
          : entry.status === 'pending'
            ? 'In review'
            : entry.status === 'rejected'
              ? 'Not verified'
              : entry.status === 'revoked'
                ? 'Revoked'
                : 'Expired';

  return (
    <div className="border-b border-slate-100 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-900">{entry.label}</span>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{entry.meaning}</p>

      {entry.checkedAt && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
          <div>
            <dt className="inline font-medium">Checked: </dt>
            <dd className="inline">{new Date(entry.checkedAt).toLocaleString()}</dd>
          </div>
          {entry.checkedBy && (
            <div>
              <dt className="inline font-medium">By: </dt>
              <dd className="inline">{entry.checkedBy}</dd>
            </div>
          )}
          {entry.source && (
            <div className="sm:col-span-2">
              <dt className="inline font-medium">Source: </dt>
              <dd className="inline">{entry.source}</dd>
            </div>
          )}
          {entry.expiresAt && (
            <div>
              <dt className="inline font-medium">Expires: </dt>
              <dd className="inline">{new Date(entry.expiresAt).toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
      )}
      {entry.scope && <p className="mt-1.5 text-xs italic text-slate-500">Scope: {entry.scope}</p>}
    </div>
  );
}

export function VerificationPanel({ entries }: { entries: VerificationEntry[] }) {
  return (
    <div>
      <div className="divide-y divide-slate-100">
        {entries.map((entry) => (
          <VerificationRow key={entry.level} entry={entry} />
        ))}
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        A verification level is recorded only after the corresponding check has actually been
        carried out, and each entry states what was checked, by whom, and when. Paying a fee never
        results in a verification level. The Universal Business Passport is a private digital
        business identity and membership credential issued by AllCompanies. It is not a
        government-issued passport, a statutory licence, a bank card, a credit facility, or a
        government endorsement.
      </p>
    </div>
  );
}
