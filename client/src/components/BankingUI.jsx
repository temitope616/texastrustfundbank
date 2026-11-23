import { Link } from 'react-router-dom';

export function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
}

export function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`));
}

export function PageHeading({ eyebrow, title, action, children }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <p className="page-description">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function InlineError({ children }) {
  return children ? <p className="form-error" role="alert">{children}</p> : null;
}

export function FieldError({ children }) {
  return children ? <span className="field-error" role="alert">{children}</span> : null;
}

export function AccountSelect({ accounts, value, onChange, name = 'accountId', label = 'Account' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} value={value} onChange={(event) => onChange(event.target.value)} required>
        <option value="">Select an account</option>
        {accounts.map((account) => (
          <option value={account.id} key={account.id}>
            {account.type === 'checking' ? 'Checking' : 'Savings'} •••• {account.last4} · {account.status === 'view-only' ? 'view only' : `${formatMoney(account.available_balance)} available`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TransactionTable({ transactions, compact = false }) {
  if (!transactions.length) return <div className="empty-state">No transactions to display.</div>;
  return (
    <div className="table-scroll">
      <table className={compact ? 'transaction-table compact' : 'transaction-table'}>
        <thead>
          <tr><th>Date</th><th>Description</th><th>Category</th><th>Status</th><th className="amount-cell">Amount</th></tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td className="date-cell">{formatDate(transaction.date)}</td>
              <td className="description-cell">{transaction.description}</td>
              <td>{transaction.category}</td>
              <td><span className={`status status-${transaction.status || 'completed'}`}>{transaction.status || 'completed'}</span></td>
              <td className={`amount-cell amount-${transaction.type}`}>
                {transaction.type === 'credit' ? '+' : '−'}{formatMoney(transaction.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccountLabel({ account, link = false }) {
  if (!account) return null;
  const content = <>{account.type === 'checking' ? 'Checking' : 'Savings'} <span className="muted">•••• {account.last4}</span></>;
  return link ? <Link className="account-label-link" to={`/accounts/${account.id}`}>{content}</Link> : content;
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((field) => `"${String(field ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}