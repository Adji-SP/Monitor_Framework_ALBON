import { useState, useEffect, useRef, useCallback } from 'react';
import { RecordingSession } from '../recordingSession';

export const useRecorder = () => {
  const [state, setState] = useState({ status: 'idle', isRecording: false, sampleCount: 0, eventCount: 0, videoBytes: 0 });
  const session = useRef(null);
  useEffect(() => {
    const instance = new RecordingSession(setState);
    session.current = instance;
    const beforeUnload = (event) => {
      if (['starting', 'recording', 'stopping'].includes(instance.status)) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); instance.dispose(); };
  }, []);
  const start = useCallback((video = true) => session.current?.start(video), []);
  const stop = useCallback(() => session.current?.stop(), []);
  const capture = useCallback((...args) => session.current?.capture(...args), []);
  return { ...state, start, stop, capture };
};
