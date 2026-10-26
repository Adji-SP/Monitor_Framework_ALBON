# Direct USB dashboard

The React dashboard now reads the ESP32 native USB Serial/JTAG port directly
using Web Serial. Sensor data does not travel through WebSocket or a Node serial
bridge. It accepts the original SENSOR READINGS blocks, headerless labelled
sensor cycles, and the confirmed DATA CSV layout below. No reflash is needed
for this dashboard change.

## Connect

1. Close espflash/PlatformIO serial monitors and stop any old dashboard backend
   still holding the COM port (Ctrl+C in its terminal).
2. In this folder, run `npm run dev`. This starts the website and the storage API
   in browser-serial mode: the API does not open USB or start WebSocket. Plain
   `node server.js` now also defaults to this mode, even if `.env` enables serial.
3. Open `http://localhost:3000` in desktop Chrome or Edge.
4. Click **Connect USB** and select the ESP32 native USB Serial/JTAG device.
   The chooser no longer restricts devices to one USB vendor/product ID.
   Select the board's current port, not a Bluetooth or unrelated serial device;
   its Windows COM number can change after reconnecting.
5. Allow access. The browser opens the selected baud rate (115200 by default),
   8-N-1 with no flow control.
   Gauges become live after the next complete sensor block (normally within
   5–10 seconds). The dashboard's **Serial monitor** shows raw USB lines and
   receive counters. **Full console** opens the separate console and parsed events.

For live readings without storage, `npm run start:web` alone is enough. A red
**Storage API offline** badge does not block USB, gauges, trends or mixer status.
For CSV/video and saved records, also run `npm run start:server`, or use `npm run dev`.

The browser's chooser requires a user click and permission. USB is not selected
silently, and there is no automatic reconnect. A busy/denied/unsupported port
shows an error beside Connect USB. Reloading or unplugging requires reconnecting;
no motor command is replayed. Use **Disconnect USB** before flashing or opening
a terminal monitor. Only one program/tab can own the port at a time.

Web Serial requires a supported browser and a secure context (localhost or
HTTPS). HTTP LAN addresses and embedded previews can block access. The dashboard
now distinguishes an insecure page, missing browser support, blocked Permissions
Policy, cancelled selection and a busy/unavailable port. See the
[Chrome Web Serial guide](https://developer.chrome.com/docs/capabilities/serial).

## Change baud rate without reloading

In the right-hand **Serial monitor**, choose **Baud rate**, then click
**Apply & refresh**. Options are 9600, 19200, 38400, 57600, 115200 and 230400.
The choice is remembered locally. If disconnected, choose the rate first and
use **Connect USB**; the refresh button is enabled only with an open connection.

This uses asynchronous Web Serial calls, not AJAX to the storage server. The
reader/writer locks are released, the same previously selected port is closed,
and it is opened with the new setting. It works even when the storage API is
offline. Merely changing the dropdown does not change a live connection; the
panel shows the current applied rate separately until reopening succeeds.

The page, raw display history and CSV/video session are not restarted. Incoming
readings briefly pause, receive counters reset, and gauges wait for a new complete
sensor block. Connection events are included in the CSV. Changing baud does not
send or replay motor commands, change firmware settings, or stop the mixer.
Refresh is disabled while a motor command is pending. Errors appear in the panel;
a failed reopen stays disconnected without automatic retries.

The current Rust firmware uses **native USB Serial/JTAG**, which ignores baud
rate. The selector changes the browser's port setting, not USB throughput or the
five-second sensor sampling interval. A real USB-to-UART adapter requires a baud
rate matching its firmware. No explicit DTR/RTS/reset signals are sent; some
USB-to-UART boards may still reset on opening a port depending on their wiring.
See [Espressif's native USB example](https://github.com/espressif/esp-serial-flasher/blob/master/examples/esp32_usb_cdc_acm_example/README.md).

## Connected, but no readings

The serial monitor in the right-hand column (below the plots on small screens)
shares the existing USB reader; it does not open a second reader or send commands.
Only the explicit **Apply & refresh** button closes/reopens that same port.
Its byte/line/frame counters cover the current connection and reset on reconnect.
Raw output is newest first, bounded by the latest 100 transport events. Pause
display and Clear view affect **only this monitor**: USB reading, gauges, charts,
recording and the full console keep receiving data. This is not a permanent log.
Use **Collapse sidebar** below the logo to give the dashboard more space. This
preference is saved locally and does not change USB ownership or recording.

- **0 bytes after 10 seconds:** USB opened, but no firmware output arrived. Check
  the cable, selected device and running firmware. The current Rust firmware
  uses native USB Serial/JTAG, not UART0 or the removed Nextion UART. Selecting
  a USB-to-UART adapter does not reroute that firmware's output.
- **Bytes, but 0 lines:** output has not supplied complete newline-terminated
  text. Check the output format, and matching firmware baud on UART devices.
- **Lines, but 0 frames:** inspect the raw output. The parser expects the
  original `================ SENSOR READINGS ================` block, a cycle
  beginning with `DS18B20 : ...`, or a complete `DATA,...` row as described below.
  Boot messages and mixer status alone are not sensor frames.
- **Frames arrive, but readings say OFFLINE/ERROR:** serial is working; those
  are sensor statuses from the ESP32, not a website transport failure.

Recoverable read errors can resume on the browser's replacement readable stream
without reopening USB. Partial blocks and stale mixer control state are discarded;
fatal errors still require an explicit reconnect. No command is retried.

## Supported sensor output formats

The reported **bytes/lines arriving but 0 frames** bug came from requiring the
old block header and treating SHT30 as the final sensor. The newer output has no
such header and prints SHT30 **before** SCD41, ending with `siklus selesai`.
The shared parser now accepts either combined-sensor order and finishes a cycle
when all nine readings are present, at the cycle-end marker, or at the next
cycle boundary. Missing sensor readings stay WAIT/null, never prior-cycle values.

The confirmed CSV layout is exactly:

```text
DATA,<counter>,<DS18B20 C>,<pH>,<pressure bar>,<O2 %Vol>,<CO2 ppm>,<SCD41 C>,<SCD41 %RH>,<SHT30 C>,<SHT30 %RH>,<metadata>
```

Counter and trailing metadata are not treated as readings or mixer status.
Unknown column counts are rejected. Empty, invalid or nonfinite sensor fields
become ERROR/null rather than zero; explicit WAIT/OFFLINE/ERROR are retained.
Numeric zero is preserved when actually reported (including the supplied CO2=0).
This fixes decoding, not sensor calibration or whether the board's zero is valid.

A matching CSV row following a complete labelled cycle does not add a second
chart/CSV-recording sample. The labelled cycle retains its pH mV and pressure V
inputs; `raw=12876` is not mistaken for millivolts. CSV-only streams can populate
all nine readings even when the browser connects mid-cycle. No units are rescaled:
pressure in `bar` stays in bar, and the legacy `kPa = ... bar` format still works.

The pasted cycle is saved as a regression fixture in
`src/shared/fixtures/reported-cycle.json` and replayed through the parser,
fragmented USB stream tests, and the browser's actual gauges/charts.

## Data and controls

- The browser and optional Node bridge share `src/shared/fermentorParser.js`.
  Fragmented USB chunks and CRLF/LF endings are assembled into complete lines;
  lines larger than 4096 characters are discarded and the parser resynchronizes.
- The same nine measurements, statuses, units and raw ADC inputs feed gauges,
  charts and CSV. OFFLINE/WAIT/ERROR stay unavailable, not synthetic zeroes.
- Mixer status and ACK lines are separate from sensor frames. USB control on
  localhost still requires deliberate clearance for RESUME, fresh matching
  boot/revision, paused state and a live Nextion interlock. Only ESP32 ACKs show
  success; timeouts/disconnects report an unknown result. No arbitrary USB
  command sender is provided. STOP remains possible with stale status while
  the port is connected, and supersedes pending RESUME.
- Closing the dashboard or disconnecting USB does **not** stop the autonomous
  mixer. Keep the physical stop available. No browser permission or software
  control replaces the Nextion interlock or the machine's physical safety.
- Recording uses the same local storage API as before; only its input source
  changed from WebSocket events to direct USB events. It captures each event
  before React renders, and never inserts a cached sensor reading at Start.

The old Node serial/WebSocket bridge is retained as `npm run start:server:bridge`
(`node server.js --serial-bridge`)
for compatible legacy clients, but is not used by this dashboard. Do not run it
while the browser owns USB. Existing database credentials/settings are unchanged.

## Verification

```powershell
npm test -- --watchAll=false --runInBand
node --test scripts/test-mixer.cjs scripts/test-recording.cjs
npm run build
npm run test:usb-browser
```

The browser smoke test requires Edge on Windows (or a Chromium executable in
`BROWSER_PATH`). It uses mocked USB streams, a synthetic canvas video, and an
isolated API writing under `build/recording-smoke-*`. It does not access the real
ESP32, send motor commands to hardware, or capture the user's display. It checks
live readings with the storage API offline, zero WebSocket connections, command
ACKs, stream cleanup, reconnect without replay, CSV and native video playback.
It also verifies the inline raw monitor, no-data/unparsed-data diagnostics and
that pausing/clearing the display does not stop incoming data or recording.
