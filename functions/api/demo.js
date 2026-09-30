// Cloudflare Pages Function : reçoit le formulaire de demande de démo.
// Variables d'environnement à définir dans Cloudflare Pages :
//   RESEND_API_KEY  clé API Resend (https://resend.com), domaine dispatchai.fr vérifié
//   DEMO_TO         adresse de réception, ex. contact@dispatchai.fr
//   DEMO_FROM       expéditeur, ex. "DispatchAI <demo@dispatchai.fr>"
// Sans RESEND_API_KEY, la fonction répond 501 et le site bascule sur un mailto pré-rempli.

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'JSON invalide' }, 400); }

  const clean = (v) => String(v ?? '').trim().slice(0, 2000);
  const name = clean(data.name), company = clean(data.company), email = clean(data.email);
  if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'Champs obligatoires manquants' }, 422);
  }
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
