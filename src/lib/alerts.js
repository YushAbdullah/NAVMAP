import { fetchGovAlerts, sortAlerts } from './alerts-core.js';
import { sampleAlerts } from './sample-alerts.js';

/**
 * Load live alerts. Order of attempts:
 *  1. our own /api/alerts proxy (Vercel function, cached)
 *  2. data.gov.my directly from the browser
 *  3. clearly-labelled sample data
 * Returns { alerts, mode: 'live' | 'sample', fetchedAt }
 */
export async function loadAlerts() {
  try {
    const r = await fetch('/api/alerts', { headers: { accept: 'application/json' } });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('json')) {
      const d = await r.json();
      // x-navmap-saved: the service worker answered with the last saved copy (weak or no signal)
      if (d.live) return { alerts: d.alerts, mode: 'live', fetchedAt: d.fetchedAt, partial: d.errors, saved: r.headers.get('x-navmap-saved') };
    }
  } catch { /* fall through */ }
  try {
    const d = await fetchGovAlerts(fetch);
    if (d.live) return { alerts: d.alerts, mode: 'live', fetchedAt: d.fetchedAt, partial: d.errors };
  } catch { /* fall through */ }
  return { alerts: sortAlerts(sampleAlerts()), mode: 'sample', fetchedAt: new Date().toISOString() };
}
