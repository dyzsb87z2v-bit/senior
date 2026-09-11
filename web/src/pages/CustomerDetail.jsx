import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { buttonClass, dangerButtonClass, Empty, ErrorNote, Loading, Modal, PageHeader, Panel, primaryButtonClass, StatusBadge } from '@/components/ui';
import { CustomerForm } from '@/pages/Customers';
import { api } from '@/lib/api';
import { formatDateDe } from '@/lib/dates';
import { modificationText } from '@/lib/orders';
import { t } from '@/i18n';

/** One customer: who they are, what they ordered, and the two GDPR actions (export, delete). */
export default function CustomerDetail() {
  const { id } = useParams();
  const { role } = useOutletContext();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setCustomer((await api.get(`/api/customers/${id}`)).customer);
      setOrders((await api.get(`/api/customers/${id}/orders`)).orders);
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const setActive = async (active) => {
    setBusy('active');
    try { await api.patch(`/api/customers/${id}`, { active }); await load(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const exportData = async () => {
    setBusy('export');
    try {
      const data = await api.get(`/api/customers/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `kunde-${customer.customerCode}-export.json`; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const remove = async () => {
    setBusy('delete');
    try { await api.delete(`/api/customers/${id}`); toast.success(t('common.saved')); navigate('/mittag/kunden'); } catch (e) { toast.error(e.message); setBusy(''); }
  };

  if (error) return <ErrorNote error={error} onRetry={load} />;
  if (!customer) return <Loading />;

  return (
    <div>
      <Link to="/mittag/kunden" className="mb-3 inline-flex items-center gap-1 text-base font-semibold underline underline-offset-4"><ArrowLeft size={16} /> {t('customers.title')}</Link>
      <PageHeader title={`#${customer.customerCode} — ${customer.salutation || ''} ${customer.firstName || ''} ${customer.lastName}`} lead={[customer.roomNumber && `${t('common.room')} ${customer.roomNumber}`, customer.phoneNumber, !customer.active ? t('customers.inactive') : t('customers.active')].filter(Boolean).join(' · ')}>
        <button type="button" className={buttonClass} onClick={() => setEditing(true)}>{t('common.edit')}</button>
        <button type="button" className={buttonClass} disabled={busy === 'active'} onClick={() => setActive(!customer.active)}>{!customer.active ? t('customers.activate') : t('customers.deactivate')}</button>
        {role === 'ADMIN' && <button type="button" className={buttonClass} disabled={busy === 'export'} onClick={exportData}><Download size={18} /> {t('customers.export')}</button>}
        {role === 'ADMIN' && <button type="button" className={dangerButtonClass} onClick={() => setConfirmDelete(true)}><Trash2 size={18} /> {t('common.delete')}</button>}
      </PageHeader>
      {customer.notes && <p className="mb-6 rounded-md border-2 border-amber-300 bg-amber-50 px-4 py-3 text-lg">{customer.notes}</p>}

      <Panel title={t('customers.history')}>
        {orders === null && <Loading />}
        {orders && orders.length === 0 && <div className="p-4"><Empty title={t('customers.noHistory')} /></div>}
        {orders && orders.length > 0 && (
          <div className="divide-y-2 divide-neutral-100">
            {orders.map((o) => {
              const mods = (o.modifications || []).map(modificationText).filter(Boolean);
              return (
                <div key={o.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wide text-neutral-600">{formatDateDe(o.orderDate)} · {t(`orders.source.${o.source || 'voice'}`)}</p>
                    <p className="text-xl font-bold">{o.quantity > 1 ? `${o.quantity} × ` : ''}{o.itemName}</p>
                    {o.components?.length > 0 && <p className="text-base text-neutral-700">{o.components.join(' · ')}</p>}
                    {mods.length > 0 && <p className="text-base font-semibold text-red-800">{mods.join(' · ')}</p>}
                    {o.allergyNote && <p className="text-base text-red-800">{t('orders.allergyNote')}: {o.allergyNote}</p>}
                  </div>
                  <StatusBadge status={o.status} />
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {editing && <CustomerForm customer={customer} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
      {confirmDelete && (
        <Modal title={t('customers.deleteTitle')} onClose={() => setConfirmDelete(false)}>
          <p className="text-lg">{t('customers.deleteText')}</p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className={buttonClass} onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
            <button type="button" className={primaryButtonClass} disabled={busy === 'delete'} onClick={remove}>{t('common.delete')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
