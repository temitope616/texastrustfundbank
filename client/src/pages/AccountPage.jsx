import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBanking } from '../contexts/BankingContext.jsx';
import { downloadCsv, formatMoney, PageHeading, TransactionTable } from '../components/BankingUI.jsx';

async function fetchAllTransactions(accountId, token) {
  const firstPage = await apiRequest(`/accounts/${accountId}/transactions?page=1`, { token });
  const remaining = await Promise.all(Array.from({ length: firstPage.totalPages - 1 }, (_, index) =>
    apiRequest(`/accounts/${accountId}/transactions?page=${index + 2}`, { token })
  ));
  return [firstPage, ...remaining].flatMap((item) => item.transactions);
}

export default function AccountPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const { accounts, loading } = useBanking();
  const account = accounts.find((item) => String(item.id) === id);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [id]);
  const [result, setResult] = useState({ transactions: [], totalPages: 1, total: 0 });
  const [flowSummary, setFlowSummary] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!token || !id) return;
    let active = true;
    apiRequest(`/accounts/${id}/transactions?page=${page}`, { token })
      .then((data) => { if (active) { setResult(data); setError(''); } })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [id, page, token]);

  useEffect(() => {
    if (!token || !id) return;
    let active = true;
    fetchAllTransactions(id, token)
      .then((transactions) => {
        if (!active) return;
        const completed = transactions.filter((item) => item.status === 'completed');
        const credits = completed.filter((item) => item.type === 'credit');
        const debits = completed.filter((item) => item.type === 'debit');
        const sources = Object.values(credits.reduce((grouped, item) => {
          const source = grouped[item.description] || { description: item.description, amount: 0, count: 0 };
          source.amount += Number(item.amount);
          source.count += 1;
          grouped[item.description] = source;
          return grouped;
        }, {})).sort((first, second) => second.amount - first.amount);
        setFlowSummary({
          moneyIn: credits.reduce((total, item) => total + Number(item.amount), 0),
          moneyOut: debits.reduce((total, item) => total + Number(item.amount), 0),
          creditCount: credits.length,
          debitCount: debits.length,
          sources
        });
      })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [id, token]);

  async function downloadStatement() {
    setDownloading(true);
    setError('');
    try {
      const transactions = await fetchAllTransactions(id, token);
      downloadCsv(`texas-trust-prototype-account-${account?.last4 || id}-activity.csv`, [
        ['Date', 'Description', 'Category', 'Type', 'Amount', 'Status', 'Balance after'],
        ...transactions.map((item) => [item.date, item.description, item.category, item.type, item.amount.toFixed(2), item.status, item.balanceAfter.toFixed(2)])
      ]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDownloading(false);
    }
  }

  if (!account) return <div className="empty-state">{loading ? 'Loading account…' : 'Account not found.'}</div>;

  return (
    <>
      <PageHeading eyebrow="ACCOUNT DETAILS" title={account.type === 'checking' ? 'Everyday Checking' : 'Growth Savings'} action={<button className="button secondary" onClick={downloadStatement} disabled={downloading}>{downloading ? 'Preparing…' : 'Download statement'}</button>}>
        Account ending in {account.last4}
      </PageHeading>
      {error && <div className="inline-banner error-banner">{error}</div>}
      <section className="account-detail-balance">
        <div><span className="eyebrow">CURRENT BALANCE</span><strong>{formatMoney(account.balance)}</strong></div>
        <div><span className="eyebrow">AVAILABLE BALANCE</span><strong>{formatMoney(account.available_balance)}</strong></div>
        <span className="account-status"><span className="security-dot" /> {account.status}</span>
      </section>
      <section className="flow-summary" aria-label="18-month money flow summary">
        <div className="flow-total"><span className="eyebrow">MONEY IN · COMPLETED</span><strong className="amount-credit">{flowSummary ? formatMoney(flowSummary.moneyIn) : '—'}</strong><span>{flowSummary?.creditCount ?? '—'} credits in this 18-month history</span></div>
        <div className="flow-total"><span className="eyebrow">MONEY OUT · COMPLETED</span><strong>{flowSummary ? formatMoney(flowSummary.moneyOut) : '—'}</strong><span>{flowSummary?.debitCount ?? '—'} debits in this 18-month history</span></div>
        <div className="flow-sources"><span className="eyebrow">WHERE MONEY CAME FROM</span>{flowSummary?.sources.length ? flowSummary.sources.map((source) => <div className="flow-source-row" key={source.description}><span>{source.description}<small>{source.count} {source.count === 1 ? 'credit' : 'credits'}</small></span><strong>{formatMoney(source.amount)}</strong></div>) : <span className="muted">Loading completed credits…</span>}</div>
      </section>
      <section className="section-block history-section">
        <div className="section-title-row"><div><p className="eyebrow">18 MONTHS OF SEEDED ACTIVITY</p><h2>Transactions <span className="muted">({result.total})</span></h2></div></div>
        <TransactionTable transactions={result.transactions} />
        <div className="pagination"><span>Page {page} of {result.totalPages}</span><div><button className="button secondary compact-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="button secondary compact-button" disabled={page >= result.totalPages} onClick={() => setPage(page + 1)}>Next</button></div></div>
      </section>
    </>
  );
}