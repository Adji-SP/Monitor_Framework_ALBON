// src/hooks/useApi.js - REST API Hook with MySQL Auth & Firebase Sensor Telemetry
import { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = 'http://localhost:3001';

export const useApi = () => {
  const [apiStatus, setApiStatus] = useState('CHECKING'); // ONLINE, OFFLINE, CHECKING
  const [healthInfo, setHealthInfo] = useState(null);
  const [sensorRecords, setSensorRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Authentication State
  const [token, setToken] = useState(() => localStorage.getItem('albon_jwt_token') || null);
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('albon_user_info');
    return saved ? JSON.parse(saved) : null;
  });

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setHealthInfo(data);
        setApiStatus('ONLINE');
        setError(null);
      } else {
        setApiStatus('OFFLINE');
      }
    } catch (err) {
      setApiStatus('OFFLINE');
      setError('Cannot reach Express API on port 3001');
    }
  }, []);

  const login = useCallback(async (username, password) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('albon_jwt_token', data.token);
        localStorage.setItem('albon_user_info', JSON.stringify(data.user));
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || 'Invalid credentials' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (username, password, role = 'operator') => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      });
      const data = await res.json();
      if (data.success) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('albon_jwt_token', data.token);
        localStorage.setItem('albon_user_info', JSON.stringify(data.user));
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || 'Registration failed' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('albon_jwt_token');
    localStorage.removeItem('albon_user_info');
  }, []);

  const fetchSensorRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/sensor-data`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const result = await res.json();
        if (result.success && Array.isArray(result.data)) {
          setSensorRecords(result.data);
        }
      }
    } catch (err) {
      console.warn('API fetchSensorRecords error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const postSensorData = useCallback(async (payload) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/sensor-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        await fetchSensorRecords();
        return { success: true, message: data.message || 'Saved to Firebase / Sensor DB' };
      } else {
        return { success: false, error: data.error || 'Failed to save' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, [fetchSensorRecords, token]);

  useEffect(() => {
    checkHealth();
    fetchSensorRecords();
    const interval = setInterval(() => {
      checkHealth();
    }, 10000);
    return () => clearInterval(interval);
  }, [checkHealth, fetchSensorRecords, token]);

  return {
    apiStatus,
    healthInfo,
    sensorRecords,
    loading,
    error,
    token,
    user,
    login,
    register,
    logout,
    checkHealth,
    fetchSensorRecords,
    postSensorData
  };
};
