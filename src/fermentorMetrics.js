// src/fermentorMetrics.js - Sensor set of the Fermentor Kopi ESP32-S3 firmware
// (IO-Fermentor-Kopi/Fermentor). Keys match the frames produced by
// lib/com/fermentorParser.js; ranges match the Nextion gauges in src/nextion.rs.

export const METRICS = {
  process_temp: { label: 'Process Temp', sensor: 'DS18B20 (GPIO12)', unit: '°C', min: 0, max: 100, decimals: 2, color: '#0284c7' },
  o2: { label: 'Oxygen', sensor: 'DFRobot SEN0322 (0x70)', unit: '%vol', min: 0, max: 25, decimals: 2, color: '#059669' },
  ph: { label: 'pH', sensor: 'ADS1115 A0 (0x48)', unit: 'pH', min: 0, max: 14, decimals: 2, color: '#6366f1' },
  co2: { label: 'CO2', sensor: 'Sensirion SCD41 (0x62)', unit: 'ppm', min: 0, max: 5000, decimals: 0, color: '#d97706' },
  scd_temp: { label: 'SCD41 Temp', sensor: 'Sensirion SCD41 (0x62)', unit: '°C', min: 0, max: 60, decimals: 2, color: '#ea580c' },
  scd_rh: { label: 'SCD41 RH', sensor: 'Sensirion SCD41 (0x62)', unit: '%RH', min: 0, max: 100, decimals: 2, color: '#db2777' },
  sht_temp: { label: 'SHT30 Temp', sensor: 'Sensirion SHT30 (0x44)', unit: '°C', min: 0, max: 60, decimals: 2, color: '#dc2626' },
  sht_rh: { label: 'SHT30 RH', sensor: 'Sensirion SHT30 (0x44)', unit: '%RH', min: 0, max: 100, decimals: 2, color: '#9333ea' },
  pressure: { label: 'Pressure', sensor: 'ADS1115 A1 (0.5-4.5 V)', unit: 'bar', min: 0, max: 12, decimals: 3, color: '#0d9488' }
};

export const METRIC_KEYS = Object.keys(METRICS);

// Same grouping as the three Nextion pages.
export const GROUPS = [
  { title: 'Process', keys: ['process_temp', 'o2', 'ph', 'co2'] },
  { title: 'Environment', keys: ['scd_temp', 'scd_rh', 'sht_temp', 'sht_rh'] },
  { title: 'Control', keys: ['pressure'] }
];

export const emptyTelemetry = () => ({
  ...Object.fromEntries(METRIC_KEYS.map((k) => [k, null])),
  status: Object.fromEntries(METRIC_KEYS.map((k) => [k, 'WAIT'])),
  raw: { ph_mv: null, pressure_v: null },
  device_id: 'AWAITING_HARDWARE',
  timestamp: null
});
