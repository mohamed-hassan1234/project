import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import client, { setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem('pos_token');
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
  }, [logout]);

  useEffect(() => {
    const token = localStorage.getItem('pos_token');
    if (!token) {
      setLoading(false);
      return;
    }
    client
      .get('/auth/me')
      .then((res) => setUser(res.data.data))
      .catch(() => {
        localStorage.removeItem('pos_token');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const res = await client.post('/auth/login', { username, password });
    localStorage.setItem('pos_token', res.data.data.token);
    setUser(res.data.data.user);
    return res.data.data.user;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
