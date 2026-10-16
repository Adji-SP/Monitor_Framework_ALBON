// src/hooks/useWebSocket.js - Embedded System Telemetry Hook (PlatformIO & Rust)
import { useState, useEffect, useRef, useCallback } from 'react';
import { METRIC_KEYS, emptyTelemetry } from '../fermentorMetrics';

export const useWebSocket = (url = 'ws://localhost:8080', onRecordEvent) => {
  const [status, setStatus] = useState('DISCONNECTED'); // CONNECTED, CONNECTING, DISCONNECTED
  const [messages, setMessages] = useState([]);
  const [activeDevice, setActiveDevice] = useState({
    name: 'Hardware Waiting...',
    source: 'ESP32-S3 USB console',
    lastSeen: null
  });

  const [telemetry, setTelemetry] = useState(emptyTelemetry);
  const [mixer, setMixer] = useState(null);
  const [mixerControlAvailable, setMixerControlAvailable] = useState(false);
  const [mixerCommand, setMixerCommand] = useState(null);
  const pendingMixer = useRef(null);
  const mixerTimer = useRef(null);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const recordEventRef = useRef(onRecordEvent);
  recordEventRef.current = onRecordEvent;

  const addLogMessage = useCallback((direction, type, payload) => {
    recordEventRef.current?.(direction, type, payload);
    const logItem = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString([], { hour12: false }),
      direction, // 'IN' | 'OUT' | 'SYS'
      type,
      payload: typeof payload === 'object' ? JSON.stringify(payload) : String(payload)
    };
    setMessages((prev) => [logItem, ...prev.slice(0, 99)]);
  }, []);

  // Frames come from the backend's Fermentor USB console parser
  // (lib/com/fermentorParser.js): { device_id, timestamp, metrics, status, raw }.
  // A sensor without an OK status has metrics[key] === null.
  const processHardwareTelemetry = useCallback((data) => {
    const payload = data.data || data.payload || data;
    if (!payload || typeof payload !== 'object' || !payload.metrics) return;

    const deviceId = payload.device_id || 'FERMENTOR_KOPI_ESP32S3';
    setActiveDevice({
      name: deviceId,
      source: payload.port ? `ESP32-S3 USB console (${payload.port})` : 'ESP32-S3 USB console',
      lastSeen: new Date().toLocaleTimeString([], { hour12: false })
    });

    const next = emptyTelemetry();
    for (const key of METRIC_KEYS) {
      const value = payload.metrics[key];
      const status = payload.status?.[key] || (Number.isFinite(value) ? 'OK' : 'ERROR');
      next[key] = status === 'OK' && Number.isFinite(value) ? value : null;
      next.status[key] = status;
    }
    next.raw = { ...next.raw, ...(payload.raw || {}) };
    next.device_id = deviceId;
    next.timestamp = payload.timestamp || new Date().toISOString();
    setTelemetry(next);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setStatus('CONNECTING');
    addLogMessage('SYS', 'CONNECTION', `Connecting to WebSocket server at ${url}...`);

    try {
      const socket = new WebSocket(url);

      socket.onopen = () => {
        setStatus('CONNECTED');
        addLogMessage('SYS', 'CONNECTED', `WebSocket connection established at ${url}`);
        
        // Register client handshake
        const handshakeMsg = {
          type: 'handshake',
          clientType: 'application',
          clientId: `react_dashboard_${Math.random().toString(36).substr(2, 5)}`
        };
        socket.send(JSON.stringify(handshakeMsg));
        addLogMessage('OUT', 'HANDSHAKE', handshakeMsg);

        // Subscribe to embedded telemetry topic
        socket.send(JSON.stringify({ type: 'subscribe', topic: 'sensors/telemetry' }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addLogMessage('IN', data.type || 'FRAME', data);

          if (data.type === 'handshake_response') {
            setMixerControlAvailable(data.mixerControlAvailable === true);
          }
          if (data.type === 'mixer_status') {
            setMixer(data.data?.version === 1 ? { ...data.data, receivedAt: Date.now() } : null);
            return;
          }
          if (data.type === 'mixer_command_result' && data.requestId === pendingMixer.current?.requestId) {
            clearTimeout(mixerTimer.current);
            pendingMixer.current = null;
            setMixerCommand({ ...data, pending: false });
            return;
          }

          // Process hardware telemetry frame
          if (
            data.type === 'sensor_update' ||
            data.type === 'telemetry' ||
            data.type === 'data' ||
            data.type === 'sensor_data' ||
            data.data ||
            data.payload
          ) {
            processHardwareTelemetry(data);
          }
        } catch (e) {
          addLogMessage('IN', 'RAW', event.data);
        }
      };

      socket.onerror = () => {
        addLogMessage('SYS', 'ERROR', 'WebSocket transport error');
      };

      socket.onclose = () => {
        if (wsRef.current !== socket) return;
        setStatus('DISCONNECTED');
        setMixer(null);
        setMixerControlAvailable(false);
        clearTimeout(mixerTimer.current);
        if (pendingMixer.current) {
          setMixerCommand({ ...pendingMixer.current, pending: false, ok: false,
            detail: 'Connection lost. Command result unknown; check the machine or use its local STOP.' });
          pendingMixer.current = null;
        }
        addLogMessage('SYS', 'DISCONNECTED', 'WebSocket connection closed');
        wsRef.current = null;

        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 4000);
      };

      wsRef.current = socket;
    } catch (err) {
      setStatus('DISCONNECTED');
      addLogMessage('SYS', 'EXCEPTION', err.message);
    }
  }, [url, addLogMessage, processHardwareTelemetry]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    clearTimeout(mixerTimer.current);
    pendingMixer.current = null;
    if (wsRef.current) {
      const socket = wsRef.current;
      wsRef.current = null;
      socket.onclose = null;
      socket.close();
    }
    setStatus('DISCONNECTED');
    setMixer(null);
    setMixerControlAvailable(false);
  }, []);

  const sendMessage = useCallback((msgObj) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload = typeof msgObj === 'string' ? msgObj : JSON.stringify(msgObj);
      wsRef.current.send(payload);
      addLogMessage('OUT', msgObj.type || 'CUSTOM', msgObj);
      return true;
    }
    addLogMessage('SYS', 'WARN', 'Cannot send: WebSocket disconnected');
    return false;
  }, [addLogMessage]);

  const sendMixerCommand = useCallback((action) => {
    if (!['STOP', 'RESUME'].includes(action) || !mixerControlAvailable) return false;
    if (action === 'RESUME' && (!mixer || Date.now() - mixer.receivedAt > 2000
        || !mixer.hmi_connected || mixer.armed || pendingMixer.current)) return false;
    if (action === 'STOP' && pendingMixer.current?.action === 'STOP') return false;
    const requestId = `mixer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const message = { type: 'mixer_command', requestId, action, bootId: mixer?.boot_id, revision: mixer?.revision };
    if (!sendMessage(message)) {
      setMixerCommand({ action, ok: false, pending: false, detail: 'Not sent: WebSocket is disconnected.' });
      return false;
    }
    clearTimeout(mixerTimer.current);
    pendingMixer.current = { requestId, action };
    setMixerCommand({ requestId, action, pending: true, detail: 'Waiting for ESP32 acknowledgement…' });
    mixerTimer.current = setTimeout(() => {
      pendingMixer.current = null;
      setMixerCommand({ requestId, action, ok: false, pending: false,
        detail: 'No acknowledgement. Result unknown; check the machine or use its local STOP.' });
    }, 5000);
    return true;
  }, [mixer, mixerControlAvailable, sendMessage]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    status,
    telemetry,
    mixer,
    mixerControlAvailable,
    mixerCommand,
    sendMixerCommand,
    messages,
    activeDevice,
    connect,
    disconnect,
    sendMessage,
    processHardwareTelemetry
  };
};
