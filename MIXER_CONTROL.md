# BTS7960 mixer dashboard

The Dashboard now shows live mixer state, applied PWM, configured PWM, Nextion
interlock and time to the next start / end of the current run. The ESP32 sends
these values over its native USB Serial/JTAG connection about once per second,
and on control-state changes. Sensor frames remain on their five-second cycle.

## Start the website

Flash the current Rust firmware first; old images do not understand USB mixer
commands. The new single-file image is
[`fermentor_kopi_web_mixer_esp32s3_merged.bin`](../IO-Fermentor-Kopi/fermentor_kopi_web_mixer_esp32s3_merged.bin).
Do not flash while the mixer could cause injury: disconnect motor power for
the initial verification. Firmware automatically arms the schedule after boot.

From `Monitor_Framework_ALBON`, retain your existing database settings in `.env`
and verify:

```dotenv
USE_SERIAL=true
USE_WS=true
SERIAL_PORT=COM8
SERIAL_BAUDRATE=115200
SERIAL_LINE_DELIMITER=\n
SERIAL_DATA_TYPES=fermentor-text
MIXER_CONTROL_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Use the actual ESP32 native USB COM port, not the Nextion UART. Close espflash's
monitor, PlatformIO serial monitor and any other program holding that port.

```powershell
npm run dev
```

Open `http://localhost:3000/#dashboard` on the computer connected to the ESP32.
Restart the backend as well as refreshing the page after updating. If CRA uses
another port, add its exact local origin to `MIXER_CONTROL_ORIGINS` and restart
the backend. Existing sensor recording/database features are unchanged.

## Controls and limits

- **Stop / pause auto** disables the bridge and pauses future scheduled runs.
  It is available even when telemetry is stale, provided the WebSocket permits
  local control. A disconnected USB port or missing firmware ACK is an error,
  never a claim that the motor stopped. Use the machine's local stop if unsure.
- **Resume auto** requires fresh telemetry, the Nextion page-0 connection,
  paused state, and checking "Mixer is clear; allow scheduled motion". It
  rearms the automatic cycle with a fresh **30-second** delay, not immediate
  motion. Stale commands, old-boot/state commands and expired commands fail.
- The schedule remains **2 minutes forward every 6 hours, start-to-start**,
  fixed at the existing example's PWM **64/255**. Website speed/reverse overrides
  are intentionally not enabled. The **3 RPM is only a target**: there is no
  encoder and PWM is not a speed measurement. "Applied PWM" reports the bridge
  command, not proof of shaft rotation.
- Website STOP and Nextion STOP act on the same firmware state. Nextion's
  keepalive remains required; the browser cannot impersonate that interlock.
- Commands show success only after ESP32 acknowledgement. A timeout means
  **result unknown**, not failure to act. Commands are not retried/replayed on
  reconnect. STOP preempts a pending RESUME.
- Closing the browser or losing the website does not cancel the machine's
  autonomous schedule. ESP32 reset/power-cycle starts a new schedule and does
  not preserve a prior STOP. Keep a physical emergency stop on motor power.

Controls currently accept **loopback peers and allowlisted local browser
origins only**, honoring existing WebSocket authentication if enabled. This
does not make the old general-purpose WebSocket framework safe for the public
internet. The stock dashboard uses its existing authentication configuration;
it does not add a token/login flow. Do not port-forward the backend. LAN/remote
control needs a separately secured deployment; Electron's historical file-based
screen is not this React dashboard and is not granted physical-control access.

## Protocol / maintenance

USB uses bounded newline-terminated ASCII commands, not Nextion UART packets:

```text
MIXER <id:u32> <STOP|RESUME> <boot_id:u32> <revision:u32> <expires_ms:u64>
[MIXER_ACK] {"id":123,"ok":true,"reason":"APPLIED"}
[MIXER_STATUS] {"version":1,...}
```

The backend generates command IDs, uses firmware uptime for a short expiry,
and checks freshness, origin, client address and state. Firmware separately
checks boot marker, revision, expiry and HMI before RESUME. STOP intentionally
does not depend on those freshness checks. Partial/oversized invalid lines are
discarded. Status/ACK messages can interleave with sensor lines without becoming
sensor values or database rows. Mixer history is not persisted to the database.

Checks without opening the real COM port or starting the motor:

```powershell
node --test scripts/test-mixer.cjs
npm test -- --watchAll=false --runInBand
npm run build
```

After flashing, verify with motor power disconnected: USB status appears,
STOP is acknowledged and shows paused/0 PWM, RESUME waits 30 seconds, Nextion
STOP updates the website, HMI loss pauses, and USB/browser loss is shown as
stale. Then validate direction, speed under load and physical stopping locally.
