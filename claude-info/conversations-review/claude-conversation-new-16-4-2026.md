# Codersh Sections — Shopify App: Full Context Summary
**Date:** 2026-04-16

---

## What It Is

A Shopify app that lets merchants browse and install pre-built Liquid sections into their store themes. Built with:

- **Backend:** Node.js + Express + Prisma ORM (PostgreSQL via Supabase) — deployed on **Render.com**
- **Frontend:** React + Vite — deployed on **Vercel**
- **Shopify Partner App:** Registered at partners.shopify.com under `project-codersh@gmail.com`

---

## What Was Done (Completed)

### 1. OAuth / Multi-store Support
- Rewrote `backend/index.js` to support full Shopify OAuth 2.0
- Routes added:
  - `GET /auth` — redirect to Shopify
  - `GET /auth/callback` — exchange code, save access token to DB
  - `GET /dev-login` — seed session for local dev (bypasses OAuth)
- Added `requireSession` middleware — all API routes now look up the shop's access token from DB
- `shop` and `token` come from `req.shop` / `req.token` set by middleware (no more hardcoded env vars)

### 2. Database — Switched from SQLite to PostgreSQL (Supabase)
- `backend/prisma/schema.prisma` — changed provider to `postgresql`, added `Session` model
- Supabase DB URL: `postgresql://postgres:codersh-sections@db.ftnntqgwjdwtidbvrhbx.supabase.co:5432/postgres`
- Migrations already run: `20260414071011_init`, `20260414073350_add_session`
- Session for `codersh-testimonials.myshopify.com` is already in DB (token saved)

### 3. Backend Deployed to Render
- Live URL: `https://codersh-shopify-section-backend.onrender.com`
- Fixed Prisma client generation on deploy: added `"postinstall": "prisma generate"` to `backend/package.json`
- **Important:** Render free tier sleeps after 15min of inactivity — first request takes ~50s to wake up

### 4. Shopify Partner App Config Updated
- `pertners-account/codersh-sections/shopify.app.toml` updated with Render URLs:
  - `application_url = "https://codersh-shopify-section-backend.onrender.com"`
  - `redirect_urls = ["https://codersh-shopify-section-backend.onrender.com/auth/callback"]`
- Deployed to Shopify Dev Dashboard via `npx shopify app deploy`

### 5. Frontend Updated for Multi-store
- `frontend/src/App.jsx` — reads `VITE_BACKEND_URL` env var, reads `?shop=` from URL params
- All API calls pass `shop` param: `/sections?shop=${SHOP}`, `/store-info?shop=${SHOP}`, etc.

---

## Current Problem (UNRESOLVED)

**Vercel frontend shows 0 sections** when visiting:
`https://codersh-shopify-section.vercel.app?shop=codersh-testimonials.myshopify.com`

**Works fine locally** at `http://localhost:5173?shop=codersh-testimonials.myshopify.com`

### Most Likely Causes (in order of probability)

1. `VITE_BACKEND_URL` env var is **not set in Vercel dashboard** — Vite falls back to `http://localhost:3000` which doesn't exist on Vercel's servers
2. Vercel deployed an **old cached build** before the env var was added — needs a fresh redeploy
3. **CORS issue** — Render backend not allowing requests from the Vercel domain

### How to Fix — Check in This Order

**Step 1:** Go to [vercel.com](https://vercel.com) → your project → **Settings → Environment Variables**
- Check if `VITE_BACKEND_URL` = `https://codersh-shopify-section-backend.onrender.com` exists
- If missing, add it and click **Redeploy**

**Step 2:** After redeploying, open browser DevTools → **Network tab** on the Vercel URL
- Check what URL the `/sections` request is hitting
- Check what status code it returns

**Step 3:** If a CORS error appears in the browser console, the Render backend's CORS config needs to whitelist the Vercel domain (add `https://codersh-shopify-section.vercel.app` to allowed origins in `backend/index.js`)

---

## What's Left After the Fix

1. **Fix Vercel env var** and confirm sections load from Render backend
2. **Test OAuth on a second dev store** — install the app fresh, go through the full OAuth flow
3. **Add Shopify App Bridge** — embed the app inside Shopify Admin (currently `embedded = false` in toml)
4. **App Store submission**

---

## Key Credentials / URLs

| Thing | Value |
|---|---|
| Render backend | `https://codersh-shopify-section-backend.onrender.com` |
| Vercel frontend | `https://codersh-shopify-section.vercel.app` |
| Supabase DB host | `db.ftnntqgwjdwtidbvrhbx.supabase.co` |
| Shopify API Key | `ae556ad0a8d99425d0dd891c6190563a` |
| Shopify API Secret | `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` |
| Partner email | `project-codersh@gmail.com` |
| Dev store | `codersh-testimonials.myshopify.com` |

---

## Immediate Next Action for New Agent

Fix the Vercel env var (`VITE_BACKEND_URL`) and verify the frontend can reach the Render backend. Once sections load on Vercel, move on to testing OAuth and App Bridge integration.
