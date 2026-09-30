# dispatchai.fr

Site vitrine DispatchAI, servi par un Cloudflare Worker avec assets statiques. Aucune étape de build.

## Structure
- `public/` : le site (index.html autonome, og-image.png, robots.txt, sitemap.xml, `_headers`)
- `src/index.js` : le Worker. Redirige www vers l'apex, sert `public/` et traite le formulaire de démo sur `POST /api/demo` (envoi via Resend)
- `wrangler.jsonc` : configuration du Worker (`npx wrangler deploy`)

## Déploiement
Le Worker `dispatchai-site` est connecté au dépôt GitHub : chaque push sur `main` redéploie (commande `npx wrangler deploy`).
URL technique : `https://dispatchai-site.<sous-domaine>.workers.dev`.

## Domaine
Worker > Settings > Domains & Routes > Add > Custom domain > `dispatchai.fr`, puis `www.dispatchai.fr`.
Le domaine doit être géré par Cloudflare (Cloudflare > Add a domain > dispatchai.fr, puis serveurs de noms Cloudflare chez Gandi).

## Formulaire de démo
Worker > Settings > Variables and Secrets :
- `RESEND_API_KEY` (secret) : clé API Resend, domaine dispatchai.fr vérifié (SPF, DKIM, DMARC dans Cloudflare DNS)
- `DEMO_TO` : `contact@dispatchai.fr`
- `DEMO_FROM` : `DispatchAI <demo@dispatchai.fr>`
Sans ces variables, le formulaire ouvre un mailto pré-rempli.

## Test local
```bash
npx wrangler dev
```
