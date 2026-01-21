# TCP Report (Vite + React)

## 1) Installation
```bash
npm install
cp .env.example .env
# puis adapte VITE_FORMSPREE_ENDPOINT si besoin
```

## 2) Lancer en local
```bash
npm run dev
```

## 3) Build
```bash
npm run build
npm run preview
```

## 4) Pourquoi tu ne recevais rien (Formspree)
Dans ton code initial, tu faisais un `fetch()` en envoyant du JSON **sans headers**.
Formspree attend au minimum:
- `Content-Type: application/json`
- `Accept: application/json`

C'est corrigé dans `src/lib/formspree.js`.

## 5) Sécurité (front)
- Minimisation: envoi du patient réduit à des initiales côté feedback (`FeedbackModal.jsx`).
- Honeypot anti-bot léger.
- CSP (meta) dans `index.html` (mieux encore si tu poses des headers serveur).
