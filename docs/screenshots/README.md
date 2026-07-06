# Screenshots

The README links to SVG **UI previews** in this folder. After you deploy, replace them with real PNG screenshots for a stronger portfolio.

## Recommended captures

| File | What to capture |
|------|-----------------|
| `cockpit-leads.png` | Leads tab with 2–3 prospect cards (Apollo or Reddit sourced) |
| `cockpit-analyse.png` | Analyse view with brief + draft message visible |
| `agent-trace.png` | Agent trace panel mid-stream (plan + tool steps) |
| `cockpit-dark.png` | Full-page dark theme (optional light theme variant) |

## How to capture

1. Deploy locally: `docker compose up` or `npm run dev` + Python agent
2. Open `http://localhost:3000/cockpit.html`
3. Run analyse on a real or demo prospect
4. Screenshot at **1280×800** or **1440×900**
5. Save PNGs here and update README image paths:

```markdown
![Leads view](docs/screenshots/cockpit-leads.png)
![Analyse view](docs/screenshots/cockpit-analyse.png)
```

## macOS shortcut

`Cmd + Shift + 4` → drag to select region → saves to Desktop.

## Privacy

Blur or use fictional names/companies if screenshots include real prospect data.
