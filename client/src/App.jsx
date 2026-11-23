import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import Shell from './components/Shell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import TransferPage from './pages/TransferPage.jsx';
import DepositPage from './pages/DepositPage.jsx';
import CardsPage from './pages/CardsPage.jsx';
import BillPayPage from './pages/BillPayPage.jsx';
import SecurityPage from './pages/SecurityPage.jsx';
import RequestsPage from './pages/RequestsPage.jsx';
import ReviewQueuePage from './pages/ReviewQueuePage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';

function ProtectedLayout() {
  const { token, user } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role === 'reviewer' && location.pathname !== '/review') return <Navigate to="/review" replace />;
  if (user?.role !== 'reviewer' && location.pathname === '/review') return <Navigate to="/dashboard" replace />;
  return <Shell />;
}

export default function App() {
  const { token, user } = useAuth();
  const home = user?.role === 'reviewer' ? '/review' : '/dashboard';
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to={home} replace /> : <LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/accounts/:id" element={<AccountPage />} />
        <Route path="/transfer" element={<TransferPage />} />
        <Route path="/deposit" element={<DepositPage />} />
        <Route path="/cards" element={<CardsPage />} />
        <Route path="/billpay" element={<BillPayPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/review" element={<ReviewQueuePage />} />
      </Route>
      <Route path="/" element={<Navigate to={token ? home : '/login'} replace />} />
      <Route path="*" element={<Navigate to={token ? home : '/login'} replace />} />
    </Routes>
  );
}