import { useEffect } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { t } from '@/i18n';

/**
 * The furniture of the lunch service: large type, strong contrast, big
 * targets, no decoration. Everything a screen needs and nothing more.
 */
export const inputClass = 'mt-1 w-full rounded-md border-2 border-neutral-300 bg-white px-4 py-3 text-lg text-neutral-900 outline-none focus:border-neutral-900 disabled:bg-neutral-100';
export const labelClass = 'block text-sm font-semibold uppercase tracking-wide text-neutral-600';
export const buttonClass = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md border-2 border-neutral-900 bg-white px-5 py-2.5 text-base font-semibold text-neutral-900 hover:bg-neutral-100 disabled:opacity-40 disabled:pointer-events-none';
export const primaryButtonClass = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md border-2 border-neutral-900 bg-neutral-900 px-5 py-2.5 text-base font-semibold text-white hover:bg-neutral-700 disabled:opacity-40 disabled:pointer-events-none';
export const dangerButtonClass = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md border-2 border-red-700 bg-white px-5 py-2.5 text-base font-semibold text-red-800 hover:bg-red-50 disabled:opacity-40 disabled:pointer-events-none';

export function PageHeader({ title, lead, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold text-neutral-900 sm:text-4xl">{title}</h1>
        {lead && <p className="mt-1 max-w-2xl text-base text-neutral-600">{lead}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`rounded-lg border-2 border-neutral-200 bg-white ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b-2 border-neutral-200 px-5 py-3">
          <h2 className="text-lg font-bold uppercase tracking-wide text-neutral-800">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Loading({ label }) {
  return (
    <div className="flex items-center gap-3 py-12 text-lg text-neutral-600" role="status" aria-live="polite">
      <Loader2 size={22} className="animate-spin" /> {label || t('common.loading')}
    </div>
  );
}

export function Empty({ title, lead, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 px-6 py-14 text-center">
      <p className="text-xl font-semibold text-neutral-800">{title}</p>
      {lead && <p className="max-w-md text-base text-neutral-600">{lead}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <p className="mb-4 flex flex-wrap items-center gap-3 rounded-md border-2 border-red-400 bg-red-50 px-4 py-3 text-base text-red-900" role="alert">
      <AlertTriangle size={18} className="shrink-0" />
      <span className="min-w-0">{error}</span>
      {onRetry && <button type="button" onClick={onRetry} className="underline underline-offset-4">{t('common.retry')}</button>}
    </p>
  );
}

export function Saved({ show }) {
  if (!show) return null;
  return <span className="inline-flex items-center gap-1 text-base font-semibold text-emerald-700"><Check size={18} /> {t('common.saved')}</span>;
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-neutral-500">{hint}</span>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center gap-3 text-lg text-neutral-900">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-6 w-6 accent-neutral-900" />
      {label}
    </label>
  );
}

/** A simple modal: one thing at a time, closable with Escape. */
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} rounded-lg bg-white shadow-xl`}>
        <header className="flex items-center justify-between border-b-2 border-neutral-200 px-5 py-4">
          <h2 className="text-2xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-2 hover:bg-neutral-100" aria-label={t('common.close')}><X size={24} /></button>
        </header>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function StatusBadge({ status, className = '' }) {
  const style = {
    NEW: 'bg-amber-100 text-amber-900 border-amber-400', CONFIRMED: 'bg-sky-100 text-sky-900 border-sky-400', PREPARING: 'bg-orange-100 text-orange-900 border-orange-400',
    READY: 'bg-emerald-100 text-emerald-900 border-emerald-500', DELIVERED: 'bg-neutral-100 text-neutral-700 border-neutral-300', CANCELLED: 'bg-red-100 text-red-900 border-red-400',
  }[status] || 'bg-neutral-100 text-neutral-700 border-neutral-300';
  return <span className={`inline-block rounded-md border-2 px-3 py-1 text-sm font-bold tracking-wide ${style} ${className}`}>{t(`status.${status}`)}</span>;
}

export function LiveDot({ live }) {
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-semibold ${live ? 'text-emerald-700' : 'text-neutral-500'}`}>
      <span className={`h-3 w-3 rounded-full ${live ? 'bg-emerald-500' : 'bg-neutral-400'}`} aria-hidden="true" />
      {live ? t('common.live') : t('common.offline')}
    </span>
  );
}

export function splitList(text) {
  return String(text || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}
