import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyTelemetry, METRIC_KEYS } from '../fermentorMetrics';
import { UsbSerialSession, emptySerialStats } from '../usbSerialSession';
import { serialSupport } from '../serialSupport';
import { BAUD_STORAGE_KEY, isBaudRate, savedBaudRate } from '../serialSettings';

export const useWebSerial = (onRecordEvent) => {
  const { supported, reason: supportReason } = serialSupport({ secureContext: window.isSecureContext, serial: navigator.serial, policy: document.permissionsPolicy || document.featurePolicy });
  const localControl = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const [connection, setConnection] = useState({ status: 'DISCONNECTED', error: null });
  const [telemetry, setTelemetry] = useState(emptyTelemetry);
  const [mixer, setMixer] = useState(null);
  const [mixerCommand, setMixerCommand] = useState(null);
  const [messages, setMessages] = useState([]);
  const [stats, setStats] = useState(emptySerialStats);
  const [baudRate, setBaudRate] = useState(savedBaudRate);
  const session = useRef(null);
  const record = useRef(onRecordEvent);
  record.current = onRecordEvent;
  const logId = useRef(0);

  useEffect(() => {
    const instance = new UsbSerialSession({
      serial: supported ? navigator.serial : null,
      canControl: () => localControl,
      onStats: setStats,
      onState: (state) => {
        setConnection(state);
        if (state.status !== 'CONNECTED') { setMixer(null); setTelemetry(emptyTelemetry()); }
      },
      onMessage: (direction, type, payload) => {
        // Capture each source event before React batches the UI updates.
        record.current?.(direction, type, payload);
        const message = { id: ++logId.current, timestamp: new Date().toLocaleTimeString([], { hour12: false }), direction, type, payload: JSON.stringify(payload) };
        setMessages((previous) => [message, ...previous].slice(0, 100));
        if (type === 'sensor_update') {
          const frame = payload.data;
          const next = emptyTelemetry();
          for (const key of METRIC_KEYS) {
            next.status[key] = frame.status?.[key] || 'ERROR';
            next[key] = next.status[key] === 'OK' && Number.isFinite(frame.metrics[key]) ? frame.metrics[key] : null;
          }
          next.raw = { ...next.raw, ...frame.raw };
          next.timestamp = frame.timestamp;
          next.device_id = frame.device_id;
          setTelemetry(next);
        } else if (type === 'mixer_status') setMixer(payload.data ? { ...payload.data, receivedAt: Date.now() } : null);
        else if (type === 'mixer_command') setMixerCommand({ ...payload, pending: true, detail: 'Waiting for ESP32 acknowledgement…' });
        else if (type === 'mixer_command_result') setMixerCommand({ ...payload, pending: false });
      }
    });
    session.current = instance;
    return () => { instance.dispose(); session.current = null; };
  }, [supported, localControl]);

  const selectBaudRate = useCallback((value) => {
    if (!isBaudRate(value) || ['CONNECTING', 'RECONNECTING', 'DISCONNECTING'].includes(session.current?.status)) return;
    setBaudRate(value);
    try { window.localStorage.setItem(BAUD_STORAGE_KEY, String(value)); }
    catch { /* Selection still works without browser storage. */ }
  }, []);
  const connect = useCallback(() => session.current?.connect(baudRate), [baudRate]);
  const refresh = useCallback(() => session.current?.reconnect(baudRate), [baudRate]);
  const disconnect = useCallback(() => session.current?.disconnect(), []);
  const sendMixerCommand = useCallback((action) => session.current?.command(action, { bootId: mixer?.boot_id, revision: mixer?.revision }), [mixer]);
  return { ...connection, supported, supportReason, connect, disconnect, refresh, baudRate, selectBaudRate, telemetry, mixer, mixerCommand, messages, stats,
    mixerControlAvailable: connection.status === 'CONNECTED' && localControl,
    sendMixerCommand, activeDevice: { name: telemetry.timestamp ? telemetry.device_id : 'Select ESP32 with Connect USB',
      source: connection.status === 'CONNECTED' ? `Direct browser USB · ${stats.baudRate} baud selected` : 'Direct browser USB · disconnected' } };
};
