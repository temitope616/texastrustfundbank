import { createContext, useContext, useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { useAuth } from './AuthContext.jsx';

const BankingContext = createContext(null);

export function BankingProvider({ children }) {
  const { token, logout } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');

  async function refreshAccounts() {
    if (!token) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setError('');
    try {
      const result = await apiRequest('/accounts', { token });
      setAccounts(result.accounts);
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.message.includes('session')) logout();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(Boolean(token));
    refreshAccounts();
  }, [token]);

  return (
    <BankingContext.Provider value={{ accounts, loading, error, refreshAccounts }}>
      {children}
    </BankingContext.Provider>
  );
}

export function useBanking() {
  const context = useContext(BankingContext);
  if (!context) throw new Error('useBanking must be used within BankingProvider.');
  return context;
}