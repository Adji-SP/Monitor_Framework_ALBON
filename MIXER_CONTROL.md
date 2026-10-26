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

The dashboard now uses [direct browser USB serial](USB_DASHBOARD.md), without
WebSocket for sensor readings or mixer commands. Retain database settings in
`.env`. Close espflash/PlatformIO serial monitors and any old Node serial bridge
holding the ESP32 native USB port, then run from `Monitor_Framework_ALBON`:

```powershell
npm run dev
```

Open `http://localhost:3000/#dashboard` in desktop Chrome/Edge and click
**Connect USB**, selecting the ESP32 USB Serial/JTAG device (currently COM9).
Restart an old backend after updating: the default scripts now use
`--browser-serial`, leaving USB to the browser. `npm run start:web` alone is
sufficient for live readings and mixer control; the API is needed for recording
and database features, not the live USB connection.

## Controls and limits

- **Stop / pause auto** disables the bridge and pauses future scheduled runs.
  It is available even when telemetry is stale, provided USB is connected from
  the localhost dashboard. A disconnected USB port or missing firmware ACK is an error,
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

Direct USB controls are enabled only on localhost/127.0.0.1/IPv6 loopback and
require explicit browser USB permission. They do not use WebSocket authentication.
The optional legacy bridge retains its own loopback/origin/authentication checks.
Do not port-forward the API or bridge. Electron's historical file-based screen
is not this React dashboard and is not granted physical-control access.

## Protocol / maintenance

USB uses bounded newline-terminated ASCII commands, not Nextion UART packets:

```text
MIXER <id:u32> <STOP|RESUME> <boot_id:u32> <revision:u32> <expires_ms:u64>
[MIXER_ACK] {"id":123,"ok":true,"reason":"APPLIED"}
[MIXER_STATUS] {"version":1,...}
```

The browser generates command IDs, uses firmware uptime for a short expiry,
and checks freshness, local origin and state. The optional Node bridge retains
equivalent checks for legacy clients. Firmware separately
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
