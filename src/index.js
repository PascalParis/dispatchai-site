// Worker dispatchai.fr : sert le site statique (public/) et reçoit le formulaire de démo sur /api/demo.
// La mesure d'audience est assurée par GoatCounter (balise dans index.html), sans cookie.
//
// Secrets à définir dans Cloudflare > Worker > Settings > Variables and Secrets :
//   RESEND_API_KEY  clé API Resend (https://resend.com), domaine dispatchai.fr vérifié
//   DEMO_TO         adresse de réception, ex. bonjour@dispatchai.fr
//   DEMO_FROM       expéditeur, ex. "DispatchAI <demo@dispatchai.fr>"
// Sans RESEND_API_KEY, /api/demo répond 501 et le site bascule sur un mailto pré-rempli.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.dispatchai.fr') {
      url.hostname = 'dispatchai.fr';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/api/demo') {
      if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
      return handleDemo(request, env);
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
      to: [env.DEMO_TO || 'bonjour@dispatchai.fr'],
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
