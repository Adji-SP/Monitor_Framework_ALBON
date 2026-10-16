# Record CSV and dashboard video

Use **Start recording** on the Dashboard or Session Recorder page. Dashboard
video is enabled by default. In the browser's sharing prompt, select this
dashboard tab and allow sharing. **No microphone, camera or system audio is
requested.** Cancelling the prompt does not start a hidden CSV-only recording.
Uncheck "Include dashboard video" if you deliberately want CSV only.

Use **Stop & save** in the compact dashboard panel, **Stop recording & save** on
Session Recorder, or the top bar's **Recording · Stop & save** from
any page. Stopping browser screen sharing also stops and saves the session.
Wait for **Saved** before closing/reloading. Recording does **not** start, stop
or change the mixer's automatic schedule; its controls remain separate.

## Saved files

Files are written incrementally to the backend computer:

```text
Monitor_Framework_ALBON/records/<session UUID>/
  session.csv
  dashboard.webm   (or dashboard.mp4 if that is the supported browser format)
  meta.json
  plot.png         (optional: Generate sensor plot after stopping)
```

CSV and video download links appear when stopped. Session Recorder's **Run
history** retains both links after a page reload. Older CSV/plot sessions remain
available. Video is recorded with the browser's native encoder, not renamed to
pretend to be MP4. The browser may determine the recorded resolution/frame rate.

## What CSV contains

Each incoming event gets a row with a UTC capture timestamp and elapsed
milliseconds. `record_type` distinguishes sensor, mixer, command, connection,
diagnostic log and session events. Separate event rows avoid pretending that
an old sensor reading is a new sample on each mixer update.

- All nine readings: DS18B20 temperature, pH, pressure, O2, CO2, SCD41
  temperature/humidity, SHT30 temperature/humidity; each sensor's status.
- Raw pH millivolts and pressure volts, source frame timestamp and device ID.
- Mixer state, armed status, applied/configured PWM, target RPM, HMI interlock,
  countdowns, configured durations, firmware uptime, boot ID and revision.
- Mixer command requests/results, connection changes and device diagnostics.
- `event_json` preserves the event payload. Authentication handshakes/tokens
  are excluded. Invalid sensor values stay blank with their error status.
  Measured mixer RPM stays blank: the hardware has no RPM feedback.

No previous cached sensor frame is inserted at Start. Frames arriving during
recording are captured directly from the WebSocket receive path, including
back-to-back frames with the same timestamp. Sensor/mixer timestamps and video
share a session, but this is not precision hardware-synchronized acquisition.

## Operation and limits

Run `npm run dev` from this folder, then open `http://localhost:3000`. This change
does not require another firmware flash if the web-mixer firmware is already
installed. Restart the backend after updating, not only the React page.

Keep the backend and browser open, the dashboard tab visible for the intended
video, the computer awake and sufficient disk space free. Changing dashboard
pages continues recording; video captures what is displayed in the selected
tab. Minimized/background tabs or OS sleep can interrupt/throttle capture.
Do not expose private content in the selected capture surface.

CSV batches are uploaded about once per second; video is encoded in roughly
two-second chunks and uploaded in parts no larger than 512 KiB. The browser
upload buffer is capped at 32 MiB; a slow/broken backend stops recording with a
visible error. Previously saved data remains. Video sessions are capped at
16 GiB. There is no promise of an unlimited-duration or power-loss-safe recording.

Unexpected close/reload, crash, lost upload or backend restart can leave partial
files. History labels incomplete/interrupted sessions; partial video may not
play. Do not treat an interrupted session as complete. Data not received over
WebSocket cannot be reconstructed; connection changes are recorded rather than
replaced by simulated readings. No recordings are automatically deleted.

Video recording requires browser screen-capture support and a secure context
(localhost or HTTPS), plus an explicit user gesture and capture permission.
See [browser screen-capture requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
and [MediaRecorder chunk/final-chunk behavior](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event).

New recording writes are restricted to loopback clients and exact local browser
origins. If the dashboard uses another port, set `RECORDING_ORIGINS` in `.env`
and restart the backend. This does not secure the legacy API/static file server
for internet exposure; recordings can contain sensitive screen contents. Do
not port-forward it. Add authentication/TLS before any remote deployment.

## Verification

```powershell
node --test scripts/test-recording.cjs scripts/test-mixer.cjs
npm test -- --watchAll=false --runInBand
npm run build
```

The CSV writer and recorder tests cover statuses/columns, ordered and duplicate
uploads, rejected paths/chunks, incomplete sessions, sharing cancellation,
CSV-only mode, the final video chunk, upload failure and cleanup. Native browser
encoding/playback is additionally smoke-tested with synthetic video and sensor
events, without capturing the user's real screen or connecting to the ESP32.
