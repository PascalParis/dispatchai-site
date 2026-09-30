// Worker dispatchai.fr : sert le site statique (public/), reçoit le formulaire de démo (/api/demo)
// et tient un compteur de vues maison, sans cookie ni script tiers (/stats).
//
// Secrets à définir dans Cloudflare > Worker > Settings > Variables and Secrets :
//   STATS_KEY       clé d'accès au tableau de bord : https://dispatchai.fr/stats?key=...
//   RESEND_API_KEY  clé API Resend (https://resend.com), domaine dispatchai.fr vérifié
//   DEMO_TO         adresse de réception, ex. contact@dispatchai.fr
//   DEMO_FROM       expéditeur, ex. "DispatchAI <demo@dispatchai.fr>"

import { DurableObject } from 'cloudflare:workers';

const BOT_RE = /bot|crawl|spider|slurp|preview|fetch|monitor|headless|lighthouse|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python|go-http/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.hostname === 'www.dispatchai.fr') {
      url.hostname = 'dispatchai.fr';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/api/demo') {
      if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
      return handleDemo(request, env);
    }

    if (url.pathname === '/stats' || url.pathname === '/api/stats') {
      return handleStats(request, env, url);
    }

    // Page d'accueil : on compte, puis on sert l'asset
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      ctx.waitUntil(countView(request, env));
    }
    return env.ASSETS.fetch(request);
  },
};

/* =========================================================
   Compteur de vues
   ========================================================= */
async function countView(request, env) {
  try {
    const ua = request.headers.get('user-agent') || '';
    if (!ua || BOT_RE.test(ua)) return;
    if (request.headers.get('purpose') === 'prefetch' || request.headers.get('sec-purpose')?.includes('prefetch')) return;

    const day = new Date().toISOString().slice(0, 10);
    // Identifiant de visiteur : empreinte journalière non réversible (IP + UA + jour + sel), jamais stockée en clair
    const ip = request.headers.get('cf-connecting-ip') || '';
    const raw = `${day}|${ip}|${ua}|${env.STATS_KEY || 'dispatchai'}`;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const visitor = [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');

    const ref = refHost(request.headers.get('referer'));
    const country = request.cf?.country || 'XX';
    const device = /mobile|android|iphone|ipad/i.test(ua) ? 'mobile' : 'desktop';

    const stub = env.COUNTER.get(env.COUNTER.idFromName('global'));
    await stub.hit({ day, visitor, ref, country, device });
  } catch (e) {
    // le compteur ne doit jamais casser le site
  }
}

function refHost(referer) {
  if (!referer) return '(direct)';
  try {
    const h = new URL(referer).hostname.replace(/^www\./, '');
    return h.endsWith('dispatchai.fr') ? '(interne)' : h;
  } catch { return '(direct)'; }
}

export class ViewCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS visitors (day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY (day, visitor));
      CREATE TABLE IF NOT EXISTS dims (kind TEXT NOT NULL, key TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (kind, key, day));
    `);
  }

  hit({ day, visitor, ref, country, device }) {
    const isNew = this.sql.exec(`SELECT 1 FROM visitors WHERE day = ? AND visitor = ?`, day, visitor).toArray().length === 0;
    if (isNew) this.sql.exec(`INSERT INTO visitors (day, visitor) VALUES (?, ?)`, day, visitor);
    this.sql.exec(
      `INSERT INTO daily (day, views, visitors) VALUES (?, 1, ?)
       ON CONFLICT(day) DO UPDATE SET views = views + 1, visitors = visitors + excluded.visitors`,
      day, isNew ? 1 : 0
    );
    for (const [kind, key] of [['ref', ref], ['country', country], ['device', device]]) {
      this.sql.exec(
        `INSERT INTO dims (kind, key, day, n) VALUES (?, ?, ?, 1)
         ON CONFLICT(kind, key, day) DO UPDATE SET n = n + 1`,
        kind, key, day
      );
    }
    // Purge des empreintes de plus de 2 jours (elles ne servent qu'au dédoublonnage du jour)
    this.sql.exec(`DELETE FROM visitors WHERE day < date('now', '-2 days')`);
  }

  stats() {
    const total = this.sql.exec(`SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(visitors),0) AS visitors, MIN(day) AS since FROM daily`).one();
    const today = new Date().toISOString().slice(0, 10);
    const d = this.sql.exec(`SELECT views, visitors FROM daily WHERE day = ?`, today).toArray()[0] || { views: 0, visitors: 0 };
    const last30 = this.sql.exec(`SELECT day, views, visitors FROM daily WHERE day >= date('now', '-29 days') ORDER BY day`).toArray();
    const top = (kind, limit) => this.sql.exec(`SELECT key, SUM(n) AS n FROM dims WHERE kind = ? AND day >= date('now', '-29 days') GROUP BY key ORDER BY n DESC LIMIT ?`, kind, limit).toArray();
    return { total, today: d, last30, referrers: top('ref', 12), countries: top('country', 12), devices: top('device', 2) };
  }
}

/* =========================================================
   Tableau de bord privé
   ========================================================= */
async function handleStats(request, env, url) {
  const key = url.searchParams.get('key') || request.headers.get('x-stats-key');
  if (!env.STATS_KEY) return new Response('Définis le secret STATS_KEY dans les paramètres du Worker.', { status: 503 });
  if (key !== env.STATS_KEY) return new Response('Accès refusé', { status: 401 });

  const stub = env.COUNTER.get(env.COUNTER.idFromName('global'));
  const s = await stub.stats();
  if (url.pathname === '/api/stats' || url.searchParams.get('format') === 'json') return json(s);

  const rows = (arr, label) => arr.length ? arr.map(r => `<tr><td>${esc(r.key)}</td><td class="n">${r.n}</td></tr>`).join('') : `<tr><td colspan="2" class="muted">${label}</td></tr>`;
  const maxV = Math.max(1, ...s.last30.map(r => r.views));
  const bars = s.last30.map(r => `<div class="bar" title="${r.day} : ${r.views} vues, ${r.visitors} visiteurs"><i style="height:${Math.round(r.views / maxV * 100)}%"></i><span>${r.day.slice(8)}</span></div>`).join('');
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>DispatchAI · Statistiques</title>
<style>
body{margin:0;background:#0E1320;color:#EEF1F7;font:15px/1.5 Inter,system-ui,sans-serif;padding:32px}
h1{font-size:22px;margin:0 0 4px}.muted{color:#8E9AB3}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:24px 0}
.card{background:#141A2A;border:1px solid #26304A;border-radius:14px;padding:18px}.card b{display:block;font-size:30px;margin-top:4px}
.chart{display:flex;align-items:flex-end;gap:4px;height:140px;background:#141A2A;border:1px solid #26304A;border-radius:14px;padding:14px 14px 26px;position:relative}
.bar{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;position:relative}
.bar i{display:block;width:100%;background:#2456F0;border-radius:4px 4px 0 0;min-height:2px}.bar span{position:absolute;bottom:-20px;font-size:10px;color:#8E9AB3}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:24px}
table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #26304A}td.n{text-align:right;font-weight:600}h3{margin:0 0 8px;font-size:14px;color:#8E9AB3;font-weight:600}
</style></head><body>
<h1>dispatchai.fr · statistiques</h1><p class="muted">Compteur serveur, sans cookie ni script tiers. Robots exclus. Visiteurs uniques dédoublonnés par jour. Depuis le ${esc(s.total.since || '')}.</p>
<div class="grid">
<div class="card"><span class="muted">Vues totales</span><b>${s.total.views}</b></div>
<div class="card"><span class="muted">Visiteurs (somme journalière)</span><b>${s.total.visitors}</b></div>
<div class="card"><span class="muted">Vues aujourd'hui</span><b>${s.today.views}</b></div>
<div class="card"><span class="muted">Visiteurs aujourd'hui</span><b>${s.today.visitors}</b></div>
</div>
<h3>Vues par jour, 30 derniers jours</h3><div class="chart">${bars || '<span class="muted">Pas encore de données</span>'}</div>
<div class="cols">
<div class="card"><h3>Sources (30 j)</h3><table>${rows(s.referrers, 'Aucune')}</table></div>
<div class="card"><h3>Pays (30 j)</h3><table>${rows(s.countries, 'Aucun')}</table></div>
<div class="card"><h3>Appareils (30 j)</h3><table>${rows(s.devices, 'Aucun')}</table></div>
</div>
<p class="muted" style="margin-top:24px">JSON : <code>/api/stats?key=…</code></p>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* =========================================================
   Formulaire de démo
   ========================================================= */
async function handleDemo(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'JSON invalide' }, 400); }

  const clean = (v) => String(v ?? '').trim().slice(0, 2000);
  const name = clean(data.name), company = clean(data.company), email = clean(data.email);
  if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'Champs obligatoires manquants' }, 422);
  }
  if (clean(data.website)) return json({ ok: true });
  if (!env.RESEND_API_KEY) return json({ error: 'Envoi non configuré' }, 501);

  const lines = [
    ['Nom', name], ['Société', company], ['E-mail', email], ['Téléphone', clean(data.phone)],
    ['GMAO', clean(data.cmms)], ['Volume mensuel', clean(data.volume)], ['Message', clean(data.message)],
    ['Origine', request.headers.get('referer') || ''], ['Date', new Date().toISOString()],
  ];
  const text = lines.map(([k, v]) => `${k} : ${v}`).join('\n');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.DEMO_FROM || 'DispatchAI <demo@dispatchai.fr>',
      to: [env.DEMO_TO || 'contact@dispatchai.fr'],
      reply_to: email,
      subject: `Demande de démo : ${company} (${name})`,
      text,
    }),
  });
  if (!r.ok) return json({ error: 'Envoi impossible' }, 502);
  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
