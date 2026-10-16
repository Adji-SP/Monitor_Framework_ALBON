#!/usr/bin/env python3
"""Plot a recorded Fermentor Kopi session CSV into a multi-panel PNG.

Usage:
    python plot_session.py <input.csv> <output.png>

Expects columns: timestamp, process_temp, o2, ph, co2, scd_temp, scd_rh,
sht_temp, sht_rh, pressure, ph_mv, pressure_v, device_id
(matches the sensor set in IO-Fermentor-Kopi/Fermentor/src/main.rs:
 DS18B20, DFRobot O2, ADS1115 pH + pressure, Sensirion SCD41, Sensirion SHT30).
Empty cells (sensor WAIT/OFFLINE/ERROR) are drawn as gaps.
"""
import csv
import sys
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

METRICS = [
    ('process_temp', 'Process temp (deg C)', '#38bdf8'),
    ('o2', 'Oxygen (%vol)', '#34d399'),
    ('ph', 'pH', '#a78bfa'),
    ('co2', 'CO2 (ppm)', '#fbbf24'),
    ('scd_temp', 'SCD41 temp (deg C)', '#fb923c'),
    ('scd_rh', 'SCD41 RH (%)', '#f472b6'),
    ('sht_temp', 'SHT30 temp (deg C)', '#f87171'),
    ('sht_rh', 'SHT30 RH (%)', '#e879f9'),
    ('pressure', 'Pressure (bar)', '#2dd4bf'),
]


def load_rows(csv_path):
    with open(csv_path, newline='', encoding='utf-8') as f:
        # New CSVs contain mixer/control/log events as well as sensor frames.
        return [row for row in csv.DictReader(f) if row.get('record_type', 'sensor') == 'sensor']


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    csv_path = Path(sys.argv[1])
    png_path = Path(sys.argv[2])
    rows = load_rows(csv_path)

    if not rows:
        print('No samples in CSV.')
        sys.exit(1)

    x = list(range(len(rows)))

    fig, axes = plt.subplots(len(METRICS), 1, figsize=(10, 2 * len(METRICS)), sharex=True)
    fig.suptitle(f'Fermentor Session - {csv_path.parent.name}', fontsize=14, fontweight='bold')

    for ax, (key, label, color) in zip(axes, METRICS):
        y = [to_float(r.get(key)) for r in rows]
        ax.plot(x, y, color=color, linewidth=1.6)
        ax.set_ylabel(label, fontsize=9)
        ax.grid(True, linestyle='--', alpha=0.3)

    axes[-1].set_xlabel('Sample #')
    fig.tight_layout(rect=[0, 0, 1, 0.97])
    png_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(png_path, dpi=130)
    print(f'Saved plot -> {png_path}')


if __name__ == '__main__':
    main()
