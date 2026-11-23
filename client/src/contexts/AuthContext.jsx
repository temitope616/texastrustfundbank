import { createContext, useContext, useState } from 'react';
import { apiRequest } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('texas-trust-prototype-token'));
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('texas-trust-prototype-user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  function storeSession(result) {
    localStorage.setItem('texas-trust-prototype-token', result.token);
    localStorage.setItem('texas-trust-prototype-user', JSON.stringify(result.user));
    setToken(result.token);
    setUser(result.user);
  }

  async function login(credentials) {
    const result = await apiRequest('/auth/login', { method: 'POST', body: credentials });
    if (result.token) storeSession(result);
    return result;
  }

  async function register(details) {
    return apiRequest('/auth/register', { method: 'POST', body: details });
  }

  async function verifyTwoFactor(challenge) {
    const result = await apiRequest('/auth/verify-2fa', { method: 'POST', body: challenge });
    storeSession(result);
  }

  function logout() {
    localStorage.removeItem('texas-trust-prototype-token');
    localStorage.removeItem('texas-trust-prototype-user');
    setToken(null);
    setUser(null);
  }

  function updateProfile(profile) {
    const updatedUser = { ...user, ...profile };
    localStorage.setItem('texas-trust-prototype-user', JSON.stringify(updatedUser));
    setUser(updatedUser);
  }

  return (
    <AuthContext.Provider value={{ token, user, login, register, verifyTwoFactor, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}