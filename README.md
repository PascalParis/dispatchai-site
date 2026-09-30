# dispatchai.fr

Site vitrine DispatchAI. Un seul fichier HTML autonome (`index.html`), sans dépendance de build.

## Contenu du dossier
- `index.html` : le site complet (styles et scripts inclus, polices Google chargées à la volée)
- `og-image.png` : image de partage réseaux sociaux (1200 x 630)
- `robots.txt`, `sitemap.xml` : référencement
- `_headers`, `_redirects` : en-têtes de sécurité et redirection www vers apex (format Cloudflare Pages)
- `functions/api/demo.js` : réception du formulaire de démo (Cloudflare Pages Function, envoi via Resend)

## Déploiement sur Cloudflare Pages
1. Pousser ce dossier dans un dépôt GitHub (`dispatchai-site`).
2. Cloudflare > Workers & Pages > Create > Pages > Connect to Git, sélectionner le dépôt.
   Build command : aucune. Output directory : `/` (racine).
3. Settings > Environment variables : `RESEND_API_KEY`, `DEMO_TO`, `DEMO_FROM` (voir `functions/api/demo.js`).
   Tant que ces variables sont absentes, le formulaire bascule automatiquement sur un mailto pré-rempli.
4. Custom domains : ajouter `dispatchai.fr` et `www.dispatchai.fr`.

## DNS chez Gandi
Deux options :
- Recommandée : transférer la gestion DNS à Cloudflare (Cloudflare > Add site > dispatchai.fr, puis remplacer les serveurs de noms chez Gandi par ceux fournis). Les enregistrements sont ensuite créés automatiquement par Pages.
- Sans changer de DNS : chez Gandi, créer `CNAME @ -> dispatchai-site.pages.dev` (si Gandi refuse un CNAME à l'apex, utiliser ALIAS) et `CNAME www -> dispatchai-site.pages.dev`.

Pour l'envoi d'e-mails depuis `@dispatchai.fr` (Resend), ajouter les enregistrements SPF, DKIM et DMARC fournis par Resend.

## À compléter avant mise en ligne
- Lien LinkedIn de la page DispatchAI dans le pied de page
- Adresse `contact@dispatchai.fr` active
