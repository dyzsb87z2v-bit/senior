import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { Empty, ErrorNote, LiveDot, Loading, PageHeader, StatusBadge, Toggle } from '@/components/ui';
import { useLiveConnection, useLiveQuery } from '@/lib/useLive';
import { api } from '@/lib/api';
import { formatDateDe, todayBerlin } from '@/lib/dates';
import { modificationText, nextStatuses } from '@/lib/orders';
import { t } from '@/i18n';

const ORDER = ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED'];

/**
 * KÜCHE: one big card per order, readable from across the room. Number,
 * dish in capitals, sides, the change in red, the room. One button, forward only.
 */
export default function Kitchen() {
  const { role } = useOutletContext();
  const today = todayBerlin();
  const live = useLiveConnection();
  const orders = useLiveQuery('/api/orders/today', ['order'], (d) => (d.orders || []).filter((o) => ORDER.includes(o.status)));
  const [showDelivered, setShowDelivered] = useState(false);
  const [busy, setBusy] = useState('');
  const list = (orders.data || []).filter((o) => showDelivered || o.status !== 'DELIVERED');
  list.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.createdAt.localeCompare(b.createdAt));

  const advance = async (o, status) => {
    setBusy(o.id);
    try { await api.patch(`/api/orders/${o.id}/status`, { status }); orders.reload(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  return (
    <div>
      <PageHeader title={`${t('kitchen.title')} — ${formatDateDe(today)}`}>
        <LiveDot live={live} />
        <Toggle label={t('kitchen.showDelivered')} checked={showDelivered} onChange={setShowDelivered} />
      </PageHeader>
      <ErrorNote error={orders.error} onRetry={orders.reload} />
      {orders.data === null && <Loading />}
      {orders.data !== null && list.length === 0 && <Empty title={t('kitchen.empty')} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((o) => {
          const mods = (o.modifications || []).map(modificationText).filter(Boolean);
          const forward = ORDER.slice(ORDER.indexOf(o.status) + 1);
          const next = nextStatuses(o.status, role).find((s) => forward.includes(s));
          return (
            <article key={o.id} className={`rounded-xl border-4 bg-white p-5 ${o.needsReview ? 'border-red-500' : o.status === 'READY' ? 'border-emerald-500' : 'border-neutral-900'}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-4xl font-black">#{o.customerCode}</p>
                <StatusBadge status={o.status} />
              </div>
              <p className="mt-3 text-3xl font-black uppercase leading-tight">{o.quantity > 1 ? `${o.quantity} × ` : ''}{o.itemName}</p>
              {o.components?.length > 0 && <p className="mt-2 text-2xl text-neutral-800">{o.components.join(' · ')}</p>}
              {mods.length > 0 && <p className="mt-3 text-2xl font-black uppercase text-red-700">{mods.join(' · ')}</p>}
              {o.allergyNote && <p className="mt-2 text-xl font-bold text-red-700">⚠ {o.allergyNote}</p>}
              {o.specialRequest && <p className="mt-2 text-xl text-neutral-800">{o.specialRequest}</p>}
              <p className="mt-4 text-2xl font-bold">{t('common.room')}: {o.roomNumber || '—'}</p>
              {next && (
                <button type="button" disabled={busy === o.id} onClick={() => advance(o, next)} className="mt-4 min-h-[64px] w-full rounded-lg bg-neutral-900 text-2xl font-black uppercase text-white hover:bg-neutral-700 disabled:opacity-50">
                  {t(`statusAction.${next}`)}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
