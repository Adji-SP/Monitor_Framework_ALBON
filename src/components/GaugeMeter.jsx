// src/components/GaugeMeter.jsx - Semi-circular radial gauge in a console-style card
import React from 'react';

// status: 'OK' | 'WAIT' | 'OFFLINE' | 'ERROR' as reported by the firmware
const STATUS_TEXT_COLOR = { WAIT: '#d97706', OFFLINE: '#9ca3af', ERROR: '#dc2626' };

export const GaugeMeter = ({ title, subtitle, value, unit, min = 0, max = 100, color = '#6366f1', targetRange, status = 'WAIT', decimals = 2, compact = false }) => {
  const isOk = status === 'OK' && Number.isFinite(value);
  const shownStatus = isOk ? 'OK' : status === 'OK' ? 'ERROR' : status;
  const safeVal = isOk ? Math.max(min, Math.min(max, value)) : min;
  const pct = (safeVal - min) / (max - min); // 0.0 to 1.0

  // Semi-circle SVG coordinates
  const radius = 65;
  const strokeWidth = 12;
  const cx = 90;
  const cy = 85;

  const angle = -180 + pct * 180; // -180 to 0

  const polarToCartesian = (centerX, centerY, r, angleInDegrees) => {
    const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
    return {
      x: centerX + r * Math.cos(angleInRadians),
      y: centerY + r * Math.sin(angleInRadians)
    };
  };

  const describeArc = (x, y, r, startA, endA) => {
    const start = polarToCartesian(x, y, r, endA);
    const end = polarToCartesian(x, y, r, startA);
    const largeArcFlag = endA - startA <= 180 ? '0' : '1';
    return ['M', start.x, start.y, 'A', r, r, 0, largeArcFlag, 0, end.x, end.y].join(' ');
  };

  const bgArcPath = describeArc(cx, cy, radius, -180, 0);
  const valueArcPath = describeArc(cx, cy, radius, -180, angle);
  const needlePos = polarToCartesian(cx, cy, radius - 15, angle);

  return (
    <div className="card gauge-card" data-compact={compact}>
      <div className="card-header">
        <span className="gauge-title" title={title}>{title}</span>
        {!compact && <span className="status-badge gauge-status" data-status={shownStatus}>{shownStatus}</span>}
      </div>

      <div className="gauge-body">
        <div className="gauge-dial">
          <svg viewBox="0 0 180 100" style={{ width: '100%', height: '100%' }} role="img" aria-label={`${title}: ${isOk ? value.toFixed(decimals) + ' ' + unit : shownStatus}`}>
            <path d={bgArcPath} fill="none" stroke="var(--gauge-track, #e5e7eb)" strokeWidth={strokeWidth} strokeLinecap="round" />
            {pct > 0 && (
              <path d={valueArcPath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
            )}
            {isOk && <>
              <line x1={cx} y1={cy} x2={needlePos.x} y2={needlePos.y} stroke="#1e293b" strokeWidth="3" strokeLinecap="round" />
              <circle cx={cx} cy={cy} r="5" fill="#1e293b" />
            </>}
            <text x="22" y="98" fill="#9ca3af" fontSize="10" fontWeight="500" textAnchor="middle">{min}</text>
            <text x="158" y="98" fill="#9ca3af" fontSize="10" fontWeight="500" textAnchor="middle">{max}</text>
          </svg>
        </div>

        <div className="gauge-reading">
          {isOk ? (
            <>
              <span className="gauge-value">{value.toFixed(decimals)}</span>
              <span className="gauge-unit">{unit}</span>
            </>
          ) : (
            <span className="gauge-state" style={{ color: STATUS_TEXT_COLOR[shownStatus] }}>{shownStatus}</span>
          )}
        </div>

        <span className="gauge-subtitle" title={[subtitle, targetRange && `Target ${targetRange}`].filter(Boolean).join(' · ')}>
          {subtitle}{!compact && targetRange ? ` · Target ${targetRange}` : ''}
        </span>
      </div>
    </div>
  );
};
