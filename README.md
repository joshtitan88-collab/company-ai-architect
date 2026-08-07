# Company AI Architect — public marketing site

Public funnel for the private AI audit product that runs on the tower (`/opt/ai-architect`, port **8787**).

## Local preview

```bash
cd ~/Projects/company-ai-architect-site
python3 -m http.server 4173
# open http://127.0.0.1:4173
```

## Deploy

Vercel project: `company-ai-architect` (team: Joshua Henry's projects).

```bash
# re-deploy from this folder after edits
npx vercel --prod --yes
```

## Notes

- Product engine stays on the tower (LAN / Tailscale). This site is marketing + intake only.
- Booking form opens a structured `mailto:` to `joshua@hhinvestigations.com`.
- Sample case study uses the Acme HVAC demo engagement (synthetic).
