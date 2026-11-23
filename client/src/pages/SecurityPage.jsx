import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { formatDate, InlineError, PageHeading } from '../components/BankingUI.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function SecurityPage() {
  const { token } = useAuth();
  const [history, setHistory] = useState([]);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest('/security/login-history', { token })
      .then((result) => {
        setHistory(result.loginHistory);
        setAlertsEnabled(result.settings.alertUnrecognizedDevice);
        setTwoFactorEnabled(result.settings.twoFactorEnabled);
      })
      .catch((requestError) => setError(requestError.message));
  }, [token]);

  async function toggleAlerts() {
    setSaving(true);
    setError('');
    try {
      const result = await apiRequest('/security/settings', { token, method: 'PATCH', body: { alertUnrecognizedDevice: !alertsEnabled } });
      setAlertsEnabled(result.settings.alertUnrecognizedDevice);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleTwoFactor() {
    setSaving(true);
    setError('');
    try {
      const result = await apiRequest('/security/two-factor', {
        token,
        method: 'PATCH',
        body: { enabled: !twoFactorEnabled }
      });
      setTwoFactorEnabled(result.settings.twoFactorEnabled);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="ACCOUNT PROTECTION" title="Security">Review your sign-in activity and account protections.</PageHeading>
      <InlineError>{error}</InlineError>
      <section className="security-settings-row">
        <div><p className="eyebrow">SIGN-IN ALERTS</p><h2>Unrecognized device alerts</h2><p>Receive an alert when a sign-in comes from a new device.</p></div>
        <button type="button" role="switch" aria-checked={alertsEnabled} className={alertsEnabled ? 'toggle enabled' : 'toggle'} disabled={saving} onClick={toggleAlerts}><span /></button>
      </section>
      <section className="security-settings-row two-factor-row">
        <div><p className="eyebrow">VERIFICATION</p><h2>Two-step verification</h2><p>{twoFactorEnabled ? 'A one-time code is required at sign-in.' : 'Password-only sign-in is enabled for your account.'} This setting affects future sign-ins.</p></div>
        <button type="button" role="switch" aria-label="Two-step verification" aria-checked={twoFactorEnabled} className={twoFactorEnabled ? 'toggle enabled' : 'toggle'} disabled={saving} onClick={toggleTwoFactor}><span /></button>
      </section>
      <section className="section-block login-history-section">
        <div className="section-title-row"><div><p className="eyebrow">RECENT ACTIVITY</p><h2>Login history</h2></div></div>
        <div className="table-scroll"><table className="transaction-table"><thead><tr><th>Date</th><th>Device</th><th>Location</th><th>Status</th></tr></thead><tbody>
          {history.map((item) => <tr key={item.id}><td>{formatDate(item.eventAt.slice(0, 10))} · {item.eventAt.slice(11, 16)}</td><td>{item.device}</td><td>{item.location}</td><td><span className={`status status-${item.status === 'success' ? 'completed' : 'failed'}`}>{item.status}</span></td></tr>)}
          {!history.length && <tr><td colSpan="4" className="empty-cell">No login activity yet.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  );
}