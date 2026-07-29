import { useEffect, useRef, useState } from 'react';

const POLL_MS = 120000;

const STATUS_META = {
  loading: { color: '#cbd5e1', label: 'WhatsApp — checking…', pulse: true },
  connected: { color: '#16a34a', label: 'WhatsApp connected — WATI accepted the health check' },
  missing_token: { color: '#dc2626', label: 'WhatsApp offline — WATI token is missing' },
  configuration_error: { color: '#dc2626', label: 'WhatsApp offline — WATI authentication or configuration needs attention' },
  service_unreachable: { color: '#d97706', label: 'WhatsApp unavailable — WATI could not be reached' },
  unknown: { color: '#94a3b8', label: 'WhatsApp status unavailable' },
};

export default function WhatsappHealthDot() {
  const [state, setState] = useState('loading');
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const response = await fetch('/api/whatsapp-health', {
          headers: { Accept: 'application/json' },
        });
        const body = response.ok ? await response.json().catch(() => null) : null;
        if (!cancelled) setState(STATUS_META[body?.status] ? body.status : 'unknown');
      } catch {
        if (!cancelled) setState('unknown');
      }
    };

    void check();
    timerRef.current = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const meta = STATUS_META[state] || STATUS_META.unknown;
  return (
    <span
      className="adm-bridge-dot"
      title={meta.label}
      aria-label={meta.label}
      role="img"
    >
      <span
        className={`adm-bridge-dot__led${meta.pulse ? ' adm-bridge-dot__led--pulse' : ''}`}
        style={{ background: meta.color, boxShadow: `0 0 0 3px ${meta.color}22` }}
      />
      <span className="adm-bridge-dot__label">WhatsApp</span>
    </span>
  );
}
