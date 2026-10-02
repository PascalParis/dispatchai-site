// Worker dispatchai.fr : sert le site statique (public/) et reçoit le formulaire de démo sur /api/demo.
// La mesure d'audience est assurée par GoatCounter (balise dans index.html), sans cookie.
//
// Secrets à définir dans Cloudflare > Worker > Settings > Variables and Secrets :
//   RESEND_API_KEY  clé API Resend (https://resend.com), domaine dispatchai.fr vérifié
//   DEMO_TO         adresse de réception, ex. bonjour@dispatchai.fr
//   DEMO_FROM       expéditeur, ex. "DispatchAI <demo@dispatchai.fr>"
// Sans domaine vérifié chez Resend, laisser DEMO_FROM vide : l'expéditeur onboarding@resend.dev
// fonctionne, à condition que DEMO_TO soit l'adresse du compte Resend.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return json({
        resend_api_key: Boolean(env.RESEND_API_KEY),
        demo_to: env.DEMO_TO ? env.DEMO_TO.replace(/(^.).*(@.*$)/, '$1***$2') : '(défaut) bonjour@dispatchai.fr',
        demo_from: env.DEMO_FROM || '(défaut) onboarding@resend.dev',
      });
    }
    if (url.pathname === '/api/demo') {
      if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
      return handleDemo(request, env);
    }
    // www vers apex pour les pages (les appels /api ci-dessus fonctionnent sur les deux adresses)
    if (url.hostname === 'www.dispatchai.fr') {
      url.hostname = 'dispatchai.fr';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleDemo(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'JSON invalide' }, 400); }

  const clean = (v) => String(v ?? '').trim().slice(0, 2000);
  const name = clean(data.name), company = clean(data.company), email = clean(data.email);
  if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'Champs obligatoires manquants' }, 422);
  }
  if (clean(data.website)) return json({ ok: true });
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY manquant');
    return json({ error: 'Envoi non configuré : RESEND_API_KEY manquant' }, 501);
  }

  const f = {
    name, company, email,
    phone: clean(data.phone), cmms: clean(data.cmms), volume: clean(data.volume), message: clean(data.message),
    origin: request.headers.get('referer') || '',
    country: request.cf?.country || '', city: request.cf?.city || '',
  };
  const date = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' }).format(new Date());
  const dash = (v) => v || 'Non renseigné';

  const text = [
    `Nouvelle demande de démo DispatchAI`,
    ``,
    `Nom : ${f.name}`, `Société : ${f.company}`, `E-mail : ${f.email}`, `Téléphone : ${dash(f.phone)}`,
    `GMAO actuelle : ${dash(f.cmms)}`, `Demandes par mois : ${dash(f.volume)}`,
    ``, `Message :`, f.message || 'Aucun message', ``,
    `Reçue le ${date}${f.city ? ` depuis ${f.city}` : ''}${f.country ? ` (${f.country})` : ''}`,
    `Page : ${f.origin}`,
  ].join('\n');

  const e = (v) => esc(v);
  const row = (label, value, empty) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #E8ECF3;width:170px;color:#6B7A90;font-size:14px;vertical-align:top">${label}</td>
        <td style="padding:10px 0;border-bottom:1px solid #E8ECF3;color:${empty ? '#9AA6B8' : '#131A2A'};font-size:15px;font-weight:${empty ? 400 : 600};vertical-align:top">${value}</td>
      </tr>`;
  const tel = f.phone.replace(/[^\d+]/g, '');
  const btn = (href, label, primary) => `<a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:999px;font-weight:600;font-size:14px;text-decoration:none;${primary ? 'background:#2456F0;color:#ffffff' : 'background:#ffffff;color:#131A2A;border:1.5px solid #C6CEDB'}">${label}</a>`;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demande de démo</title></head>
<body style="margin:0;padding:0;background:#F3F5F9;font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${e(f.company)} souhaite une démo de DispatchAI${f.volume ? ` (${e(f.volume)} demandes par mois)` : ''}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #D9DFE9">
        <tr><td style="background:#0E1320;padding:26px 32px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:34px;height:34px;background:#2456F0;border-radius:9px;color:#fff;font-weight:700;font-size:18px;text-align:center;vertical-align:middle">D</td>
            <td style="padding-left:10px;color:#ffffff;font-size:19px;font-weight:700;letter-spacing:-0.02em">DispatchAI</td>
          </tr></table>
          <p style="margin:22px 0 4px;color:#FFB020;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Nouvelle demande de démo</p>
          <p style="margin:0;color:#ffffff;font-size:24px;font-weight:700;line-height:1.25">${e(f.company)}</p>
          <p style="margin:6px 0 0;color:#8E9AB3;font-size:15px">${e(f.name)}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 6px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${row('E-mail', `<a href="mailto:${e(f.email)}" style="color:#2456F0;text-decoration:none">${e(f.email)}</a>`)}
            ${row('Téléphone', f.phone ? `<a href="tel:${e(tel)}" style="color:#2456F0;text-decoration:none">${e(f.phone)}</a>` : 'Non renseigné', !f.phone)}
            ${row('GMAO actuelle', e(dash(f.cmms)), !f.cmms)}
            ${row('Demandes par mois', e(dash(f.volume)), !f.volume)}
          </table>
        </td></tr>
        <tr><td style="padding:18px 32px 4px">
          <p style="margin:0 0 8px;color:#6B7A90;font-size:14px">Ce que le prospect aimerait voir</p>
          <div style="background:#F3F5F9;border-radius:12px;padding:16px 18px;color:${f.message ? '#131A2A' : '#9AA6B8'};font-size:15px;line-height:1.55;white-space:pre-wrap">${f.message ? e(f.message) : 'Aucun message'}</div>
        </td></tr>
        <tr><td style="padding:24px 32px 28px">
          ${btn(`mailto:${e(f.email)}?subject=${encodeURIComponent('Votre démo DispatchAI')}`, 'Répondre', true)}
          ${f.phone ? `&nbsp; ${btn(`tel:${e(tel)}`, 'Appeler', false)}` : ''}
        </td></tr>
        <tr><td style="padding:16px 32px;background:#F8F9FC;border-top:1px solid #E8ECF3;color:#6B7A90;font-size:12.5px;line-height:1.6">
          Reçue le ${e(date)}${f.city ? ` depuis ${e(f.city)}` : ''}${f.country ? ` (${e(f.country)})` : ''}<br>
          Page : ${e(f.origin || 'dispatchai.fr')}
        </td></tr>
      </table>
      <p style="margin:16px 0 0;color:#9AA6B8;font-size:12px">Formulaire de démo · dispatchai.fr</p>
    </td></tr>
  </table>
</body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.DEMO_FROM || 'DispatchAI <onboarding@resend.dev>',
      to: [env.DEMO_TO || 'bonjour@dispatchai.fr'],
      reply_to: f.email,
      subject: `Demande de démo : ${f.company}, ${f.name}${f.volume ? ` (${f.volume} demandes/mois)` : ''}`,
      text, html,
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    console.error('Resend error', r.status, detail);
    return json({ error: 'Envoi impossible', status: r.status, detail: detail.slice(0, 300) }, 502);
  }
  return json({ ok: true });
}

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
