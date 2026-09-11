import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu as MenuIcon, X, ShieldAlert, Bell } from 'lucide-react';
import { Toaster } from 'sonner';
import { useAuth } from '@/lib/auth';
import { canSee } from '@/lib/roles';
import { useLiveQuery } from '@/lib/useLive';
import { Loading } from '@/components/ui';
import { t } from '@/i18n';

/**
 * The lunch service's own frame: a light, large-type interface for the
 * restaurant, separate from the gallery's dark Control Center. Navigation
 * follows the day's work. A kitchen account sees the kitchen and the orders,
 * nothing else; a member of staff everything but the settings' admin parts.
 */
const NAV = [
  { to: '/mittag', end: true, key: 'today', area: 'today' },
  { to: '/mittag/bestellungen', key: 'orders', area: 'orders' },
  { to: '/mittag/kueche', key: 'kitchen', area: 'kitchen' },
  { to: '/mittag/kunden', key: 'customers', area: 'customers' },
  { to: '/mittag/speiseplan', key: 'menu', area: 'menu' },
  { to: '/mittag/anrufe', key: 'calls', area: 'calls' },
  { to: '/mittag/einstellungen', key: 'settings', area: 'settings' },
];

export default function LunchLayout() {
  const { user, logout } = useAuth();
  const role = user && user.active ? user.role : null;
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => { document.title = `${t('app.title')} — ${t('app.subtitle')}`; }, []);

  if (!role) {
    return (
      <div className="min-h-screen bg-neutral-50 px-6 py-24 text-center text-neutral-900">
        <ShieldAlert size={40} className="mx-auto text-red-700" />
        <h1 className="mt-4 text-3xl font-bold">{t('access.denied')}</h1>
        <p className="mx-auto mt-3 max-w-md text-lg text-neutral-700">{t('access.deniedText')}</p>
        <button type="button" onClick={logout} className="mt-8 rounded-md border-2 border-neutral-900 px-5 py-3 text-base font-semibold">{t('app.logout')}</button>
      </div>
    );
  }
  const items = NAV.filter((n) => canSee(role, n.area));
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900" style={{ fontSize: '18px' }}>
      <header className="sticky top-0 z-40 border-b-2 border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-xl font-bold leading-tight">{t('app.title')}</p>
            <p className="text-sm text-neutral-600">{t(`app.role.${role}`)} · {user?.email}</p>
          </div>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Hauptnavigation">
            {items.map((n) => <Item key={n.key} {...n} />)}
            {role !== 'KITCHEN' && <AlertsBadge />}
          </nav>
          <div className="flex items-center gap-2">
            <button type="button" onClick={logout} className="hidden min-h-[44px] items-center gap-2 rounded-md border-2 border-neutral-300 px-3 text-sm font-semibold hover:border-neutral-900 lg:inline-flex"><LogOut size={16} /> {t('app.logout')}</button>
            <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border-2 border-neutral-300 lg:hidden" aria-label="Menü" aria-expanded={open}>{open ? <X size={24} /> : <MenuIcon size={24} />}</button>
          </div>
        </div>
        {open && (
          <nav className="border-t-2 border-neutral-200 bg-white px-4 py-3 lg:hidden" aria-label="Hauptnavigation">
            <div className="flex flex-col gap-1">
              {items.map((n) => <Item key={n.key} {...n} block />)}
              <button type="button" onClick={logout} className="mt-2 inline-flex min-h-[48px] items-center gap-2 rounded-md border-2 border-neutral-300 px-4 text-base font-semibold"><LogOut size={18} /> {t('app.logout')}</button>
            </div>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Suspense fallback={<Loading />}>
          <Outlet context={{ role, user }} />
        </Suspense>
      </main>
      {/* Large, high-contrast notifications: a new order must be seen from across the counter. */}
      <Toaster position="top-right" richColors toastOptions={{ style: { fontSize: '18px', padding: '16px 20px' } }} />
    </div>
  );
}

function Item({ to, end, block }) {
  const label = t(`nav.${NAV.find((n) => n.to === to).key}`);
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `inline-flex min-h-[48px] items-center rounded-md px-3 text-base font-bold tracking-wide ${block ? 'w-full' : ''} ${isActive ? 'bg-neutral-900 text-white' : 'text-neutral-800 hover:bg-neutral-100'}`}>
      {label}
    </NavLink>
  );
}

function AlertsBadge() {
  const { data } = useLiveQuery('/api/alerts', ['alert'], (d) => d.alerts || []);
  const n = (data || []).length;
  if (!n) return null;
  return (
    <NavLink to="/mittag" className="ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-md bg-red-700 px-3 text-sm font-bold text-white" aria-label={`${n} ${t('today.alerts')}`}>
      <Bell size={16} /> {n}
    </NavLink>
  );
}
