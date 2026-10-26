const uint = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const u32 = (n) => uint(n, 0xffffffff);
const isMixerStatus = (s) => s && s.version === 1 && s.driver === 'BTS7960'
  && u32(s.boot_id) && u32(s.revision) && uint(s.uptime_ms)
  && ['AUTO PAUSED', 'AUTO WAIT', 'AUTO FWD'].includes(s.state)
  && typeof s.armed === 'boolean' && typeof s.hmi_connected === 'boolean'
  && uint(s.output_pwm, 255) && uint(s.configured_pwm, 255)
  && uint(s.target_rpm, 255) && s.measured_rpm === null
  && ['next_start_in_ms', 'run_remaining_ms', 'start_delay_ms', 'run_duration_ms', 'interval_ms'].every((k) => uint(s[k]));

module.exports = { isMixerStatus, u32 };
