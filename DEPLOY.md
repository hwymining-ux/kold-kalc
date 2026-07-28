# Deploy Kold Kalc to a free live link (Render.com)

This gets you a permanent `https://kold-kalc.onrender.com`-style URL that runs in the
cloud — **your laptop can be off.** Free, no credit card.

## One-time setup (~10 minutes)

### 1. Put the code on GitHub (free)
1. Make a free account at **github.com** if you don't have one.
2. Click **+ → New repository**. Name it `kold-kalc`, leave it **empty** (no README), Create.
3. GitHub shows you a repo URL like `https://github.com/YOURNAME/kold-kalc.git`. Copy it.
4. In a terminal in this folder (`C:\Users\young\kold-katcher-roi`), run:
   ```bash
   git remote add origin https://github.com/YOURNAME/kold-kalc.git
   git branch -M main
   git push -u origin main
   ```
   (The repo is already committed locally — you just push it.)

### 2. Deploy on Render (free)
1. Make a free account at **render.com** (sign in with GitHub — easiest).
2. Click **New + → Web Service**.
3. Connect your `kold-kalc` GitHub repo.
4. Render auto-detects the settings from `render.yaml`. Confirm:
   - **Runtime:** Node · **Build:** `npm install` · **Start:** `node server.js` · **Plan:** Free
5. Click **Create Web Service**. First deploy takes 2–3 minutes.
6. Your live URL appears at the top: `https://kold-kalc.onrender.com` — share that.

## What to know about the free tier
- **It sleeps after 15 min of no traffic.** The next visitor waits ~30–60s for it to wake
  up, then it's fast. Fine for sharing; annoying for a live demo (open it a minute before).
- **Data is not permanent.** The free tier wipes the database on each restart/redeploy, so
  the hosted link is a **clean demo instance** — your real working data stays on your laptop.
  (Want permanent data? Add a Render persistent disk, ~$7/mo, and set `KKROI_DB` to a path on it.)
- **No login.** Anyone with the URL can view and edit. Treat the link as semi-private
  (share with your partner, don't post it publicly), and **don't enter real API keys or
  confidential pricing** on the public instance. Ask and I'll add a password gate if you want it locked.

## Updating the live site later
Make changes, then:
```bash
git add -A
git commit -m "update"
git push
```
Render redeploys automatically on every push.
