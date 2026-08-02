import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ClipboardList, Search, ShieldCheck } from 'lucide-react';

const FOUNDATIONS = [
  {
    id: 'product-intelligence',
    title: 'Product Intelligence',
    description: 'Open one Positill CODE and review its joined operational picture.',
    icon: Search,
    status: 'Frontend ready',
  },
  {
    id: 'buying',
    title: 'Buying',
    description: 'The future home of supplier intake, Apollo evidence and Atlas recommendations.',
    icon: ClipboardList,
    status: 'Shell ready',
  },
];

export default function HermesPanel({ onSelectSection }) {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/backend-health', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Backend Health unavailable');
        if (!cancelled) setHealth(payload);
      })
      .catch(() => { if (!cancelled) setHealth({ checks: [], unavailable: true }); });
    return () => { cancelled = true; };
  }, []);

  const exceptions = (health?.checks || []).filter((check) => ['critical', 'warning'].includes(check.state));

  return (
    <section className="adm-panel intelligence-panel" aria-labelledby="hermes-title">
      <div className="adm-section-head intelligence-panel__head">
        <div>
          <div className="intelligence-eyebrow"><Bot size={15} /> Proto Intelligence</div>
          <h2 id="hermes-title" className="adm-section-title">Hermes</h2>
          <p className="adm-section-note">
            A read-only foundation for joined Positill, website and buying intelligence inside the existing admin login.
          </p>
        </div>
        <span className="intelligence-readonly"><ShieldCheck size={15} /> Read-only foundation</span>
      </div>

      <div className="intelligence-callout" role="status">
        <strong>The first authenticated intelligence lookup is connected.</strong>
        <span>Product Intelligence can now join available Positill and website data. Sales, incoming stock and saved buying decisions remain staged for later phases.</span>
      </div>

      <section className="hermes-exceptions" aria-labelledby="hermes-exceptions-title">
        <div className="hermes-exceptions__head">
          <div>
            <h3 id="hermes-exceptions-title">Operational exceptions</h3>
            <p>Live warnings from Backend Health, shown here as the work that needs attention first.</p>
          </div>
          <button type="button" className="adm-btn-ghost adm-btn--sm" onClick={() => onSelectSection('backend-health')}>Open Backend Health</button>
        </div>
        {health?.unavailable ? (
          <div className="hermes-exception hermes-exception--warning"><AlertTriangle size={17} /><span>Backend Health is unavailable. Open it for diagnostic detail.</span></div>
        ) : health === null ? (
          <p className="adm-section-note">Checking operational health…</p>
        ) : exceptions.length ? (
          <div className="hermes-exception-list">
            {exceptions.slice(0, 6).map((check) => (
              <button key={check.id} type="button" className={`hermes-exception hermes-exception--${check.state}`} onClick={() => onSelectSection('backend-health')}>
                <AlertTriangle size={17} />
                <span><strong>{check.label}</strong><small>{check.summary}</small></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="hermes-exception hermes-exception--healthy"><CheckCircle2 size={17} /><span>No critical or warning exceptions are currently reported.</span></div>
        )}
      </section>

      <div className="intelligence-launch-grid">
        {FOUNDATIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className="intelligence-launch-card"
              onClick={() => onSelectSection(item.id)}
            >
              <span className="intelligence-launch-card__icon"><Icon size={20} /></span>
              <span className="intelligence-launch-card__copy">
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
              <span className="intelligence-status-tag">{item.status}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
