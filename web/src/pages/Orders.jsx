import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import OrderCard from '@/components/OrderCard';
import { buttonClass, Empty, ErrorNote, Field, inputClass, LiveDot, Loading, Modal, PageHeader, primaryButtonClass, splitList } from '@/components/ui';
import { useLiveConnection, useLiveQuery } from '@/lib/useLive';
import { api } from '@/lib/api';
import { addDays, formatDateDe, todayBerlin, weekdayDe } from '@/lib/dates';
import { ORDER_STATUSES } from '@/lib/orders';
import { t } from '@/i18n';

/** BESTELLUNGEN: a day at a time, filterable by status; staff can enter an order by hand. */
export default function Orders() {
  const { role } = useOutletContext();
  const [date, setDate] = useState(todayBerlin());
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState(false);
  const live = useLiveConnection();
  const orders = useLiveQuery(`/api/orders?date=${date}`, ['order'], (d) => d.orders || [], [date]);
  const list = useMemo(() => (orders.data || []).filter((o) => !status || o.status === status), [orders.data, status]);

  return (
    <div>
      <PageHeader title={t('orders.title')} lead={`${weekdayDe(date)}, ${formatDateDe(date)}`}>
        <LiveDot live={live} />
        {role !== 'KITCHEN' && <button type="button" className={primaryButtonClass} onClick={() => setManual(true)}><Plus size={18} /> {t('orders.manual')}</button>}
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2">
          <button type="button" className={buttonClass} onClick={() => setDate(addDays(date, -1))} aria-label={t('common.yesterday')}><ChevronLeft size={20} /></button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="min-h-[48px] rounded-md border-2 border-neutral-300 px-3 text-lg" aria-label={t('orders.date')} />
          <button type="button" className={buttonClass} onClick={() => setDate(addDays(date, 1))} aria-label={t('common.tomorrow')}><ChevronRight size={20} /></button>
          <button type="button" className={buttonClass} onClick={() => setDate(todayBerlin())}>{t('common.today')}</button>
        </div>
        <label className="block">
          <span className="block text-sm font-semibold uppercase text-neutral-600">{t('orders.filter')}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 min-h-[48px] rounded-md border-2 border-neutral-300 bg-white px-3 text-lg">
            <option value="">{t('common.all')}</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
        </label>
      </div>

      <ErrorNote error={orders.error} onRetry={orders.reload} />
      {orders.data === null && <Loading />}
      {orders.data !== null && list.length === 0 && <Empty title={t('orders.empty')} />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((o) => <OrderCard key={o.id} order={o} role={role} onChanged={orders.reload} />)}
      </div>

      {manual && <ManualOrder date={date} onClose={() => setManual(false)} onSaved={() => { setManual(false); orders.reload(); }} />}
    </div>
  );
}

function ManualOrder({ date, onClose, onSaved }) {
  const [customers, setCustomers] = useState(null);
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ customerId: '', menuItemId: '', quantity: 1, modifications: '', specialRequest: '', allergyNote: '' });
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/api/customers').then((r) => setCustomers(r.customers)).catch(() => setCustomers([]));
    api.get(`/api/menu/${date}`).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [date]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const filtered = (customers || []).filter((c) => !q || `${c.customerCode} ${c.firstName || ''} ${c.lastName}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await api.post('/api/orders', { ...form, orderDate: date, quantity: Number(form.quantity) || 1, modifications: splitList(form.modifications) });
      toast.success(t('common.saved')); onSaved();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  return (
    <Modal title={`${t('orders.manualTitle')} — ${formatDateDe(date)}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <ErrorNote error={error} />
        {(customers === null || items === null) && <Loading />}
        <Field label={t('common.customer')}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className={inputClass} />
          <select required value={form.customerId} onChange={(e) => set('customerId', e.target.value)} className={inputClass} size={Math.min(6, Math.max(2, filtered.length))}>
            {filtered.map((c) => <option key={c.id} value={c.id}>#{c.customerCode} {c.salutation} {c.firstName} {c.lastName}{c.roomNumber ? ` · ${t('common.room')} ${c.roomNumber}` : ''}</option>)}
          </select>
        </Field>
        <Field label={t('orders.dish')}>
          <select required value={form.menuItemId} onChange={(e) => set('menuItemId', e.target.value)} className={inputClass}>
            <option value="">—</option>
            {(items || []).map((m) => <option key={m.id} value={m.id} disabled={m.available === false}>{m.position}. {m.nameDe}{m.available === false ? ` (${t('menu.unavailable')})` : ''}</option>)}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('orders.quantity')}><input type="number" min="1" max="20" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className={inputClass} /></Field>
          <Field label={t('orders.specialRequest')}><input value={form.specialRequest} onChange={(e) => set('specialRequest', e.target.value)} className={inputClass} /></Field>
        </div>
        <Field label={t('orders.modifications')}><textarea rows={2} value={form.modifications} onChange={(e) => set('modifications', e.target.value)} className={inputClass} /></Field>
        <Field label={t('orders.allergyNote')}><input value={form.allergyNote} onChange={(e) => set('allergyNote', e.target.value)} className={inputClass} /></Field>
        <div className="flex justify-end gap-3">
          <button type="button" className={buttonClass} onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className={primaryButtonClass} disabled={saving}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
