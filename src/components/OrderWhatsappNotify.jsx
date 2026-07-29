import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  UserRoundCheck,
} from 'lucide-react';

function stamp(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DeliveryStep({ icon: Icon, label, state, detail, error }) {
  const ok = state === 'ok';
  const failed = state === 'error';
  return (
    <div className={`oa-delivery-step oa-delivery-step--${state}`}>
      <span className="oa-delivery-step-icon"><Icon size={15} /></span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
        {error && <small className="oa-delivery-step-error">{error}</small>}
      </span>
      {ok && <CheckCircle2 size={15} />}
      {failed && <AlertTriangle size={15} />}
    </div>
  );
}

export default function OrderWhatsappNotify({ orderId }) {
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState('');
  const [message, setMessage] = useState('');

  const loadLog = () => {
    if (!orderId) return Promise.resolve();
    setLoading(true);
    return fetch(`/api/order-notify-log?orderId=${encodeURIComponent(orderId)}`)
      .then((r) => r.json())
      .then((data) => setLog(data))
      .catch(() => setLog({ found: false, loadError: true }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void loadLog();
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendAction = async (action, confirm = undefined) => {
    setSending(action);
    setMessage('');
    try {
      const resp = await fetch('/api/order-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, action, confirm }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Notification request failed');
      setMessage(action === 'resend-internal-email'
        ? `Order email resent to ${data.recipient || 'online@proto.co.za'} with the PDF attached.`
        : 'Missing order notifications sent.');
      await loadLog();
    } catch (err) {
      setMessage(err.message || 'Notification request failed.');
    } finally {
      setSending('');
    }
  };

  const resendInternal = () => {
    const recipient = log?.alertEmail || log?.emailRecipients?.[0] || 'online@proto.co.za';
    if (!window.confirm(`Resend this existing order to ${recipient}? This will not create a new order.`)) return;
    void sendAction('resend-internal-email', 'RESEND');
  };

  if (loading) {
    return (
      <div className="oa-wa-notify oa-wa-notify--loading">
        <Loader2 size={14} className="star-spinning" /> Checking order delivery…
      </div>
    );
  }

  const found = Boolean(log?.found);
  const pdfOk = Boolean(log?.pdfStored || log?.emailPdfAttached);
  const internalOk = Boolean(log?.emailSent);
  const customerKnown = log?.customerEmailSent != null;
  const customerOk = log?.customerEmailSent === true;
  const whatsappSkipped = Boolean(log?.whatsappNotConfigured || log?.skippedNoToken || log?.skippedNoTeam);
  const accepted = Number(log?.accepted ?? log?.sent ?? 0);
  const delivered = Number(log?.delivered || 0);
  const read = Number(log?.read || 0);
  const sendFailed = Number(log?.failed || 0);
  const deliveryFailed = Number(log?.deliveryFailed || 0);
  const totalFailed = sendFailed + deliveryFailed;
  const hasDeliveryTracking = log?.deliveryConfirmed != null || (log?.sentDetails || []).some((entry) => entry.messageId);
  const whatsappOk = accepted > 0 && delivered === accepted;
  const whatsappPending = accepted > delivered && totalFailed === 0;
  const whatsappError = totalFailed > 0;
  const lastAt = log?.updatedAt || log?.at;

  return (
    <section className={`oa-wa-notify oa-delivery-control${internalOk ? ' oa-wa-notify--ok' : ' oa-wa-notify--err'}`}>
      <div className="oa-wa-notify-head">
        <strong>Order delivery control</strong>
        <span className="oa-wa-notify-meta">
          {found ? `Last checked ${stamp(lastAt) || 'recently'}` : 'No delivery record yet'}
        </span>
        <button
          type="button"
          className="oa-wa-notify-retry"
          onClick={() => void loadLog()}
          disabled={Boolean(sending)}
          title="Refresh delivery status"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="oa-delivery-grid">
        <DeliveryStep
          icon={FileCheck2}
          label="Order PDF"
          state={pdfOk ? 'ok' : found ? 'error' : 'unknown'}
          detail={pdfOk ? `Stored${log?.emailPdfSource ? ` · ${log.emailPdfSource}` : ''}` : 'No stored PDF confirmed'}
        />
        <DeliveryStep
          icon={Mail}
          label="Internal email"
          state={internalOk ? 'ok' : found ? 'error' : 'unknown'}
          detail={internalOk
            ? `Sent to ${(log.emailRecipients || [log.alertEmail]).filter(Boolean).join(', ') || 'online@proto.co.za'}${log.internalEmailLastResentAt ? ` · resent ${stamp(log.internalEmailLastResentAt)}` : ''}`
            : 'Not confirmed as sent'}
          error={log?.emailFailReason}
        />
        <DeliveryStep
          icon={UserRoundCheck}
          label="Customer email"
          state={!customerKnown ? 'unknown' : customerOk ? 'ok' : 'error'}
          detail={!customerKnown
            ? 'Not recorded on older orders'
            : customerOk
              ? `Sent to ${log.customerEmailRecipient || 'customer'}${log.customerEmailAt ? ` · ${stamp(log.customerEmailAt)}` : ''}`
              : 'Not confirmed as sent'}
          error={log?.customerEmailFailReason}
        />
        <DeliveryStep
          icon={MessageCircle}
          label="Team WhatsApp"
          state={whatsappSkipped ? 'skipped' : whatsappOk ? 'ok' : whatsappError ? 'error' : whatsappPending ? 'pending' : 'unknown'}
          detail={whatsappSkipped
            ? 'Not configured / no team recipients'
            : hasDeliveryTracking
              ? `${accepted}/${Number(log?.teamSize || 0)} accepted · ${delivered} delivered · ${read} read · ${totalFailed} failed`
              : `${accepted}/${Number(log?.teamSize || 0)} accepted by WATI · delivery not tracked on this older order`}
          error={whatsappError
            ? `${totalFailed} WhatsApp message${totalFailed === 1 ? '' : 's'} failed${log?.statusBlockedReason ? ` · ${log.statusBlockedReason}` : ''}`
            : whatsappPending
              ? 'Accepted by WATI; awaiting delivered/read receipt'
              : null}
        />
      </div>

      <div className="oa-delivery-actions">
        <button
          type="button"
          className="oa-wa-notify-retry"
          onClick={resendInternal}
          disabled={Boolean(sending) || !found}
        >
          {sending === 'resend-internal-email' ? <Loader2 size={12} className="star-spinning" /> : <Mail size={12} />}
          Resend internal email + PDF
        </button>
        {(!found || !internalOk || (whatsappError && !whatsappSkipped)) && (
          <button
            type="button"
            className="oa-wa-notify-retry"
            onClick={() => void sendAction('send-missing')}
            disabled={Boolean(sending)}
          >
            {sending === 'send-missing' ? <Loader2 size={12} className="star-spinning" /> : <RefreshCw size={12} />}
            Send missing notifications
          </button>
        )}
      </div>
      {message && <p className="oa-wa-notify-msg">{message}</p>}
      {log?.deliveryHistory?.length > 0 && (
        <details className="oa-delivery-history">
          <summary>Delivery history ({log.deliveryHistory.length})</summary>
          <ul>
            {[...log.deliveryHistory].reverse().map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <strong>{event.ok ? 'Sent' : 'Failed'}</strong> · {stamp(event.at)}
                {event.by ? ` · ${event.by}` : ''}
                {event.recipient ? ` · ${event.recipient}` : ''}
                {event.error ? ` · ${event.error}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
