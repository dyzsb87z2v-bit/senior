import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Loading } from '@/components/ui';
import Login from '@/pages/Login';
import LunchLayout from '@/LunchLayout';

const Today = lazy(() => import('@/pages/Today'));
const Orders = lazy(() => import('@/pages/Orders'));
const Kitchen = lazy(() => import('@/pages/Kitchen'));
const Customers = lazy(() => import('@/pages/Customers'));
const CustomerDetail = lazy(() => import('@/pages/CustomerDetail'));
const Menu = lazy(() => import('@/pages/Menu'));
const Calls = lazy(() => import('@/pages/Calls'));
const Settings = lazy(() => import('@/pages/Settings'));

/** Anything under /mittag needs a signed-in account; the layout then applies the role. */
function RequireUser({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === null) return <Loading />;
  if (user === false) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/mittag" element={<RequireUser><LunchLayout /></RequireUser>}>
              <Route index element={<Today />} />
              <Route path="bestellungen" element={<Orders />} />
              <Route path="kueche" element={<Kitchen />} />
              <Route path="kunden" element={<Customers />} />
              <Route path="kunden/:id" element={<CustomerDetail />} />
              <Route path="speiseplan" element={<Menu />} />
              <Route path="anrufe" element={<Calls />} />
              <Route path="einstellungen" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/mittag" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
