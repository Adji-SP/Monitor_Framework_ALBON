const FermentorParser = require('./fermentorParser');
const reported = require('./fixtures/reported-cycle.json');

function setup() {
  const frames = [], events = [];
  const parser = new FermentorParser({ onFrame: (frame) => frames.push(frame), onEvent: (event) => events.push(event) });
  return { parser, frames, events, push: (lines) => lines.forEach((line) => parser.push(line)) };
}
const metrics = { process_temp: 24.38, ph: 6.38, pressure: 2.280, o2: 21.57,
  co2: 0, scd_temp: 25.28, scd_rh: 71.1, sht_temp: 24.89, sht_rh: 61.3 };
// Synthetic CSV counterpart of the supplied human-readable cycle, for deduplication tests.
const matchingCsv = 'DATA,306,24.38,6.38,2.280,21.57,0,25.28,71.1,24.89,61.3,0';

test('reported headerless cycle includes SCD41 after SHT30, raw mV and pressure volts', () => {
  const { push, frames } = setup(); push(reported.lines);
  expect(frames).toHaveLength(1);
  expect(frames[0].metrics).toEqual(metrics);
  expect(frames[0].raw).toEqual({ ph_mv: 1609.5, pressure_v: 1.260 });
  expect(Object.values(frames[0].status)).toEqual(Array(9).fill('OK'));
});

test('reported DATA row maps nine sensors, not the prefix counter or trailing metadata', () => {
  const { parser, frames } = setup(); parser.push(reported.csv);
  expect(frames).toHaveLength(1);
  expect(frames[0].metrics).toEqual({ process_temp: 24.37, ph: 6.38, pressure: 2.199, o2: 21.63,
    co2: 0, scd_temp: 25.27, scd_rh: 71.2, sht_temp: 24.93, sht_rh: 61.3 });
  expect(frames[0].raw).toEqual({ ph_mv: null, pressure_v: null });
});

test('text followed by matching CSV counts once and preserves raw voltages', () => {
  const { push, parser, frames } = setup();
  push(reported.lines); parser.push(matchingCsv);
  expect(frames).toHaveLength(1);
  expect(frames[0].raw.ph_mv).toBe(1609.5);
  // A new cycle with unchanged readings is still a new chart point.
  push(reported.lines); parser.push(matchingCsv.replace(',306,', ',311,'));
  expect(frames).toHaveLength(2);
  // CSV-only streams also retain repeated measurements from distinct cycles.
  parser.push(matchingCsv.replace(',306,', ',316,'));
  expect(frames).toHaveLength(3);
});

test('supplied newest-first capture, reordered chronologically, gives two distinct cycles', () => {
  const { push, frames } = setup(); push([reported.csv, ...reported.lines]);
  expect(frames).toHaveLength(2);
  expect(frames.map((frame) => frame.metrics.pressure)).toEqual([2.199, 2.280]);
});

test('header-based legacy C++ still works with either sensor-group order and kPa/raw conversion', () => {
  for (const groups of [[reported.lines[5], reported.lines[4]], [reported.lines[4], reported.lines[5]]]) {
    const { push, frames } = setup();
    push(['================ SENSOR READINGS ================', ...reported.lines.slice(0, 2),
      'Pressure : 228.0 kPa = 2.280 bar (1.260 V)', reported.lines[3], ...groups]);
    expect(frames).toHaveLength(1);
    expect(frames[0].metrics).toEqual(metrics);
    expect(frames[0].raw.pressure_v).toBe(1.260);
  }
});

test('CSV unavailable fields stay null, with no blank/NaN/address coerced to zero', () => {
  const { parser, frames } = setup();
  parser.push('DATA,310,NaN,,2.280,OFFLINE,0,WAIT,ERROR,24.89,0x44,0');
  expect(frames[0].metrics).toMatchObject({ process_temp: null, ph: null, pressure: 2.280, o2: null,
    co2: 0, scd_temp: null, scd_rh: null, sht_temp: 24.89, sht_rh: null });
  expect(frames[0].status).toMatchObject({ process_temp: 'ERROR', ph: 'ERROR', o2: 'OFFLINE', scd_temp: 'WAIT', scd_rh: 'ERROR', sht_rh: 'ERROR' });
});

test('text faults and warmup remain unavailable when paired CSV uses numeric placeholders', () => {
  const { push, parser, frames } = setup();
  push(reported.lines.map((line) => line.startsWith('O2 ') ? 'O2 : WAIT (WARMUP 02:59)' : line));
  parser.push(matchingCsv.replace(',21.57,', ',0,'));
  expect(frames).toHaveLength(1);
  expect(frames[0].status.o2).toBe('WAIT'); expect(frames[0].metrics.o2).toBeNull();
});

test('partial cycles finish with WAIT for missing sensors and never carry old data forward', () => {
  const { push, frames } = setup(); push(reported.lines);
  push(['DS18B20 : 25.00 C', 'O2 : OFFLINE', '------------- siklus selesai -------------']);
  expect(frames).toHaveLength(2);
  expect(frames[1].metrics).toMatchObject({ process_temp: 25, ph: null, o2: null, co2: null, sht_temp: null });
  expect(frames[1].raw).toEqual({ ph_mv: null, pressure_v: null });
  expect(frames[1].status.ph).toBe('WAIT'); expect(frames[1].status.o2).toBe('OFFLINE');
});

test('boot messages, missing CSV columns and metadata cannot become sensor frames', () => {
  const { push, frames, events } = setup();
  push(['[OK] ADS1115 0x48', 'DS18B20 : initialized on GPIO12', 'SCD41 periodic start: OK',
    '------------- siklus selesai -------------', 'DATA,1,2,3',
    'DATA,counter,24.37,6.38,2.199,21.63,0,25.27,71.2,24.93,61.3,0',
    reported.csv + ',extra', reported.csv.replace(/,0$/, ',metadata')]);
  expect(frames).toHaveLength(0); expect(events.length).toBeGreaterThan(0);
});

test('reset discards partial frames and duplicate suppression after transport interruption', () => {
  const { parser, push, frames } = setup();
  push(reported.lines); parser.reset(); parser.push(matchingCsv);
  expect(frames).toHaveLength(2);
  push(['DS18B20 : 99 C', 'pH : 6.00 (1500 mV)']); parser.reset();
  push(reported.lines.slice(2));
  expect(frames).toHaveLength(2);
  parser.push(reported.csv);
  expect(frames).toHaveLength(3); expect(frames[2].metrics.process_temp).toBe(24.37);
});
