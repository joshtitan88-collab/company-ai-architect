# Company AI Architect — public site

Canonical public company: **https://companyaiarchitect.com** (domain registered; DNS still on IONOS parking until pointed here).

Working copies:

- This repo (GitHub Pages): https://joshtitan88-collab.github.io/company-ai-architect/
- Story mirror: `~/Projects/k3-architect-story/public/` → https://k3-architect-story.vercel.app

Product engine stays LAN-only: http://192.168.1.201:8787/

## Local preview

```bash
cd ~/Projects/company-ai-architect-site
python3 -m http.server 4173
```

## Deploy

```bash
npx vercel --prod --yes --scope joshua-henry-s-projects
```

Contact remains `joshua@hhinvestigations.com` until a mailbox exists on the company domain. Keep IONOS MX if you add email later.
