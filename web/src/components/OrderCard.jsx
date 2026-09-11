import { useState } from 'react';
import { AlertTriangle, Phone, PenLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/ui';
import { modificationText, nextStatuses } from '@/lib/orders';
import { timeDe } from '@/lib/dates';
import { api } from '@/lib/api';
import { t } from '@/i18n';

/**
 * One order, as the restaurant reads it: who, what, what to change, and the
 * one or two buttons that move it along. Large, unambiguous, no hover-only
 * controls.
 */
export default function OrderCard({ order, role, onChanged, compact = false }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const options = nextStatuses(order.status, role);
  const mods = (order.modifications || []).map(modificationText).filter(Boolean);

  const setStatus = async (status) => {
    setBusy(status); setError('');
    try { await api.patch(`/api/orders/${order.id}/status`, { status }); if (onChanged) onChanged(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  return (
    <article className={`rounded-lg border-2 bg-white p-4 ${order.needsReview ? 'border-red-400' : 'border-neutral-300'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold text-neutral-900">#{order.customerCode} <span className="font-semibold text-neutral-700">{order.customerName}</span></p>
          <p className="text-base text-neutral-600">
            {order.roomNumber && <span>{t('common.room')} {order.roomNumber} · </span>}
            {order.source === 'voice' ? <Phone size={14} className="inline" /> : <PenLine size={14} className="inline" />} {t(`orders.source.${order.source || 'voice'}`)} · {timeDe(order.createdAt)}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="mt-3">
        <p className="text-xl font-bold uppercase text-neutral-900">{order.quantity > 1 ? `${order.quantity} × ` : ''}{order.itemName}</p>
        {!compact && order.components?.length > 0 && <p className="text-lg text-neutral-700">{order.components.join(' · ')}</p>}
        {mods.length > 0 && <p className="mt-1 text-lg font-bold uppercase text-red-800">{mods.join(' · ')}</p>}
        {order.specialRequest && <p className="mt-1 text-base text-neutral-800"><strong>{t('orders.specialRequest')}:</strong> {order.specialRequest}</p>}
        {order.allergyNote && <p className="mt-1 text-base font-semibold text-red-800"><AlertTriangle size={16} className="inline" /> {t('orders.allergyNote')}: {order.allergyNote}</p>}
        {order.needsReview && order.reviewReason && <p className="mt-1 text-sm text-red-800"><strong>{t('today.review')}:</strong> {order.reviewReason}</p>}
      </div>

      {error && <p className="mt-2 text-base text-red-800" role="alert">{error}</p>}

      {options.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {options.map((s) => (
            <button key={s} type="button" disabled={!!busy} onClick={() => setStatus(s)}
              className={`min-h-[48px] rounded-md border-2 px-4 py-2 text-base font-bold ${s === 'CANCELLED' ? 'border-red-700 text-red-800 hover:bg-red-50' : 'border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700'} disabled:opacity-50`}>
              {busy === s ? '…' : t(`statusAction.${s}`)}
            </button>
          ))}
          {!compact && order.callId && role !== 'KITCHEN' && (
            <Link to={`/mittag/anrufe?call=${order.callId}`} className="ml-auto inline-flex min-h-[48px] items-center text-base font-semibold text-neutral-700 underline underline-offset-4">{t('orders.call')}</Link>
          )}
        </div>
      )}
    </article>
  );
}
