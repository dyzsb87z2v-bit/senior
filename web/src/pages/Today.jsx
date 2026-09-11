import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Bell, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import OrderCard from '@/components/OrderCard';
import { Empty, ErrorNote, LiveDot, Loading, Panel, PageHeader, StatusBadge } from '@/components/ui';
import { useLiveConnection, useLiveQuery } from '@/lib/useLive';
import { api } from '@/lib/api';
import { formatDateDe, timeDe, todayBerlin, weekdayDe } from '@/lib/dates';
import { modificationText, ORDER_STATUSES } from '@/lib/orders';
import { t } from '@/i18n';

/** HEUTE: what came in, what needs a person, what state the day is in. Updates itself. */
export default function Today() {
  const { role } = useOutletContext();
  const today = todayBerlin();
  const live = useLiveConnection();
  const orders = useLiveQuery('/api/orders/today', ['order'], (d) => d.orders || []);
  const alerts = useLiveQuery('/api/alerts', ['alert'], (d) => d.alerts || []);
  const menu = useLiveQuery('/api/menu/today', ['menu'], (d) => d.items || []);
  const calls = useLiveQuery('/api/calls?limit=200', ['call'], (d) => (d.calls || []).filter((c) => (c.startedAt || '').slice(0, 10) === today));
  const [resolving, setResolving] = useState('');

  // A new order announces itself, once, with the customer's number and the dish.
  const seen = useRef(null);
  useEffect(() => {
    const ev = orders.lastEvent;
    if (!ev || ev.action !== 'create' || !ev.data || seen.current === ev.id) return;
    seen.current = ev.id;
    const mods = (ev.data.modifications || []).map(modificationText).join(', ');
    toast(`${t('today.newOrderToast')} — #${ev.data.customerCode} ${ev.data.customerName || ''}`, {
      description: `${ev.data.itemName}${mods ? ' · ' + mods : ''} · ${timeDe(ev.data.createdAt || new Date().toISOString())}`,
      icon: <Bell size={18} />, duration: 12000,
    });
  }, [orders.lastEvent]);

  const list = useMemo(() => orders.data || [], [orders.data]);
  const counts = useMemo(() => Object.fromEntries(ORDER_STATUSES.map((s) => [s, list.filter((o) => o.status === s).length])), [list]);
  const fresh = list.filter((o) => o.status === 'NEW' || o.status === 'CONFIRMED');
  const rest = list.filter((o) => !['NEW', 'CONFIRMED'].includes(o.status));
  const noMenu = menu.data && !menu.data.some((m) => m.available !== false);

  const resolve = async (id) => {
    setResolving(id);
    try { await api.post(`/api/alerts/${id}/resolve`); alerts.reload(); } catch (e) { toast.error(e.message); } finally { setResolving(''); }
  };

  return (
    <div>
      <PageHeader title={t('today.title')} lead={`${weekdayDe(today)}, ${formatDateDe(today)}`}>
        <LiveDot live={live} />
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ORDER_STATUSES.map((s) => (
          <div key={s} className="rounded-lg border-2 border-neutral-200 bg-white p-3 text-center">
            <p className="text-3xl font-bold">{counts[s] || 0}</p>
            <StatusBadge status={s} className="mt-1" />
          </div>
        ))}
      </div>

      {noMenu && (
        <p className="mb-6 rounded-md border-2 border-amber-400 bg-amber-50 px-4 py-3 text-base text-amber-900">
          {t('today.menuMissing')} <Link to="/mittag/speiseplan" className="font-bold underline underline-offset-4">{t('today.openMenu')}</Link>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ErrorNote error={orders.error} onRetry={orders.reload} />
          <Panel title={`${t('today.newOrders')} (${fresh.length})`}>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {orders.data === null && <Loading />}
              {orders.data !== null && fresh.length === 0 && <div className="md:col-span-2"><Empty title={t('today.noOrders')} /></div>}
              {fresh.map((o) => <OrderCard key={o.id} order={o} role={role} onChanged={orders.reload} />)}
            </div>
          </Panel>
          {rest.length > 0 && (
            <Panel title={`${t('today.allOrders')} (${list.length})`} className="mt-6">
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {rest.map((o) => <OrderCard key={o.id} order={o} role={role} onChanged={orders.reload} compact />)}
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title={`${t('today.alerts')} (${(alerts.data || []).length})`}>
            <div className="divide-y-2 divide-neutral-100">
              {alerts.data === null && <Loading />}
              {alerts.data && alerts.data.length === 0 && <p className="px-5 py-6 text-base text-neutral-600">{t('today.noAlerts')}</p>}
              {(alerts.data || []).map((a) => (
                <div key={a.id} className={`px-5 py-3 ${a.severity === 'critical' ? 'bg-red-50' : ''}`}>
                  <p className="text-sm font-bold uppercase tracking-wide text-neutral-700">{t(`alerts.${a.type}`)} · {timeDe(a.createdAt)}</p>
                  <p className="mt-1 text-base text-neutral-900">{a.message}</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {a.callId && <Link to={`/mittag/anrufe?call=${a.callId}`} className="text-base font-semibold underline underline-offset-4">{t('orders.call')}</Link>}
                    <button type="button" disabled={resolving === a.id} onClick={() => resolve(a.id)} className="inline-flex items-center gap-1 text-base font-semibold text-emerald-800 underline underline-offset-4"><CheckCircle2 size={16} /> {t('today.resolve')}</button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title={t('today.callsToday')}>
            <div className="grid grid-cols-2 gap-3 p-4 text-center">
              <div><p className="text-3xl font-bold">{(calls.data || []).length}</p><p className="text-sm uppercase text-neutral-600">{t('nav.calls')}</p></div>
              <div><p className="text-3xl font-bold">{(calls.data || []).filter((c) => c.callStatus === 'handoff').length}</p><p className="text-sm uppercase text-neutral-600">{t('today.handoffs')}</p></div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
