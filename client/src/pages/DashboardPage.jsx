import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBanking } from '../contexts/BankingContext.jsx';
import { AccountLabel, formatMoney, PageHeading, TransactionTable } from '../components/BankingUI.jsx';

const quickActions = [
  { to: '/transfer', title: 'Transfer', detail: 'Move money between accounts' },
  { to: '/deposit', title: 'Deposit check', detail: 'Deposit from your phone' },
  { to: '/billpay', title: 'Pay bills', detail: 'Schedule a payment' },
  { to: '/cards', title: 'Card controls', detail: 'Lock or report a card' }
];
const todayLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric'
}).format(new Date()).toUpperCase();

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { token, user } = useAuth();
  const { accounts, loading, error } = useBanking();
  const [transactions, setTransactions] = useState([]);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(null);

  useEffect(() => {
    if (!token) return;
    apiRequest('/security/login-history', { token })
      .then((result) => setTwoFactorEnabled(result.settings.twoFactorEnabled))
      .catch(() => setTwoFactorEnabled(null));
  }, [token]);

  useEffect(() => {
    if (!token || !accounts.length) return;
    let active = true;
    Promise.all(accounts.map((account) => apiRequest(`/accounts/${account.id}/transactions?page=1`, { token })))
      .then((pages) => {
        if (active) setTransactions(pages.flatMap((page) => page.transactions).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 10));
      })
      .catch(() => { if (active) setTransactions([]); });
    return () => { active = false; };
  }, [accounts, token]);

  const checkingAccount = accounts.find((account) => account.type === 'checking');

  return (
    <>
      <PageHeading eyebrow={todayLabel} title={`${greeting()}${user?.displayName ? `, ${user.displayName}` : ''}`} action={<span className="secure-label"><span className="security-dot" /> Secure session</span>}>
        Your accounts at a glance.
      </PageHeading>
      {error && <div className="inline-banner error-banner">{error}</div>}
      <section className="balance-overview" aria-label="Primary checking balance">
        <div className="total-balance-block"><span className="eyebrow">EVERYDAY CHECKING</span><strong>{loading || !checkingAccount ? '—' : formatMoney(checkingAccount.balance)}</strong><span>Account ending in {checkingAccount?.last4 || '----'}</span></div>
        <div className="balance-accent"><span>Available checking</span><strong>{loading || !checkingAccount ? '—' : formatMoney(checkingAccount.available_balance)}</strong></div>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section className="section-block">
            <div className="section-title-row"><div><p className="eyebrow">DEPOSIT ACCOUNTS</p><h2>Accounts</h2></div><span className="small-count">{accounts.length} accounts</span></div>
            <div className="account-list">
              {accounts.map((account) => (
                <Link to={`/accounts/${account.id}`} className="account-row" key={account.id}>
                  <span className={`account-symbol ${account.type}`}>{account.type === 'checking' ? 'C' : 'S'}</span>
                  <span className="account-name"><strong>{account.type === 'checking' ? 'Everyday Checking' : 'Growth Savings'}</strong><span>•••• {account.last4} · {account.status === 'view-only' ? 'view only' : account.status}</span></span>
                  <span className="account-balance"><strong>{formatMoney(account.balance)}</strong><span>{formatMoney(account.available_balance)} available</span></span>
                  <span className="row-arrow" aria-hidden="true">›</span>
                </Link>
              ))}
              {!loading && !accounts.length && <div className="empty-state">No accounts are available.</div>}
            </div>
          </section>
          {checkingAccount?.status === 'view-only' && <div className="inline-banner error-banner">This new account starts at $0. Deposits, transfers, bill payments, and withdrawals are disabled.</div>}

          <section className="section-block">
            <div className="section-title-row"><div><p className="eyebrow">QUICK ACCESS</p><h2>What would you like to do?</h2></div></div>
            <div className="action-grid">
              {quickActions.map((action, index) => (
                <Link to={action.to} className="action-item" key={action.to}><span className={`action-number action-${index}`}>0{index + 1}</span><span><strong>{action.title}</strong><small>{action.detail}</small></span><span className="action-arrow">↗</span></Link>
              ))}
            </div>
          </section>

          <section className="section-block transactions-block">
            <div className="section-title-row"><div><p className="eyebrow">LATEST ACTIVITY</p><h2>Recent transactions</h2></div><Link className="subtle-link" to={`/accounts/${accounts[0]?.id || ''}`}>View all activity <span>→</span></Link></div>
            <TransactionTable transactions={transactions} compact />
          </section>
        </div>

        <aside className="dashboard-aside">
          <section className="aside-section security-aside">
            <div className="aside-heading"><span className="aside-symbol">+</span><span>SECURITY CENTER</span></div>
            <h3>Your accounts are protected.</h3>
            <p>{twoFactorEnabled === null ? 'Review your sign-in protections.' : twoFactorEnabled ? 'Two-step verification is on for your account.' : 'Two-step verification is off. Turn it on for added protection.'}</p>
            <Link to="/security" className="aside-link">Review security <span>→</span></Link>
          </section>
          <section className="aside-section statements-aside">
            <div className="aside-heading"><span className="aside-symbol lines">≡</span><span>STATEMENTS</span></div>
            <h3>Account activity</h3>
            <p>Review and download transaction history.</p>
            {accounts.map((account) => <Link className="statement-link" key={account.id} to={`/accounts/${account.id}`}><AccountLabel account={account} /><span>→</span></Link>)}
          </section>
          <div className="aside-footnote">Demo data is for illustration only and does not represent a real account.</div>
        </aside>
      </div>
    </>
  );
}