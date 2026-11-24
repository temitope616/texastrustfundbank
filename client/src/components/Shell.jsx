import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import BrandLockup from './BrandLockup.jsx';

const customerNavigation = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/transfer', label: 'Transfers' },
  { to: '/requests', label: 'Requests' },
  { to: '/deposit', label: 'Mobile deposit' },
  { to: '/billpay', label: 'Bill pay' },
  { to: '/cards', label: 'Cards' },
  { to: '/security', label: 'Security' },
  { to: '/profile', label: 'Profile & settings' }
];
const reviewerNavigation = [{ to: '/review', label: 'Review queue', end: true }];

export default function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigation = user?.role === 'reviewer' ? reviewerNavigation : customerNavigation;
  const title = navigation.find((item) => location.pathname === item.to)?.label || 'Accounts';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/dashboard" aria-label="Texas Legal Trust Fund Bank home">
          <BrandLockup compact inverse />
        </Link>
        <div className="nav-caption">YOUR MONEY</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <span className="nav-indicator" />{item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-security"><span className="security-dot" />Your connection is secure</div>
          <span className="sidebar-note">Demo environment</span>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><BrandLockup compact /></div>
          <div className="topbar-title">{title}</div>
          <div className="topbar-user">
            <span className="user-initial">{(user?.displayName || user?.email || 'D')[0].toUpperCase()}</span>
            <span className="user-email">{user?.displayName || user?.email}</span>
            <button type="button" className="text-button" onClick={logout}>Sign out</button>
          </div>
        </header>
        <div className="global-disclosure" role="note"></div>
        <main className="page-content"><Outlet />Texas Legal Trust Fund Bank</main>
        <footer className="page-footer"><span>Texas Legal Trust Fund Bank · </span><span>Simulated activity only</span></footer>
      </div>
    </div>
  );
}