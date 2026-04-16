# Project Handoff Brief — Codersh Sections

## What We're Building

A Shopify section store app called **Codersh Sections** — works exactly like MIT Sections Pro. Merchants install the app, browse a library of pre-designed Liquid sections, click "Add to Theme", and the section appears natively in their Shopify theme editor as a standalone section (not under "Apps" block).

---

## How It Works (Technical Architecture)

- Merchant clicks "Add to Theme" in the React dashboard
- Node.js backend calls Shopify Admin API: `PUT /themes/{id}/assets.json`
- This writes the `.liquid` file directly into the merchant's theme `sections/` folder
- Section appears natively in Shopify theme editor under "Add section" — indistinguishable from built-in sections
- This is called **Theme API injection** — same method MIT Sections Pro uses

---

## What's Already Built & Working

### Backend (Node.js + Express)

- `backend/index.js` — Express server on port 3000
- Routes: `GET /sections`, `POST /inject-section`, `DELETE /remove-section`
- Reads `.liquid` files from `backend/sections/liquid/`
- Reads CSS/JS asset files from `backend/sections/assets/`
- Injects liquid + assets into active Shopify theme via Admin API
- Prisma + SQLite database tracking installed sections per shop

### Frontend (React + Vite)

- Section library dashboard on port 5173
- Search + category filtering
- Real SVG mini-mockup previews for each section (not placeholder letters)
- "Add to Theme" / "Remove from Theme" buttons with states
- "Open Theme Editor" button after install
- Installed state persists after page refresh (from database)

### Sections Library (10 sections)

All converted from TAE block format to injectable standalone sections:

- T01 Horizontal Scroll (single file)
- T02 Infinite Marquee (single file)
- T03 Video Testimonials (single file)
- T04 Chat Testimonials (single file)
- T05 Center Carousel (**multi-file**: liquid + `cws-t05.css` + `cws-t05.js`) — rebuilt with block-based cards, image picker per card
- T06 Split Stats (single file)
- T07 Before & After Slider (single file)
- T08 Timeline (single file)
- T09 Floating Cards (single file)
- T10 Masonry Grid (single file)

### File Structure

```
Codersh-Sections-Shopify-App/
  backend/
    index.js              ← main server
    sections/
      index.js            ← sections registry with getSectionLiquid + getSectionAssets
      liquid/             ← all .liquid files
      assets/             ← cws-t05.css, cws-t05.js
    prisma/
      schema.prisma       ← InstalledSection model
      dev.db              ← SQLite database (local only)
    .env                  ← SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_ACCESS_TOKEN, SHOP, DATABASE_URL
  frontend/
    src/
      App.jsx             ← main dashboard
      App.css             ← all styles
      SectionPreviews.jsx ← SVG preview components
```

### Database Schema (Prisma)

```prisma
model InstalledSection {
  id          String   @id @default(cuid())
  shop        String
  sectionId   String
  sectionName String
  installedAt DateTime @default(now())
  @@unique([shop, sectionId])
}
```

---

## Current Limitation

The app currently uses a **legacy custom app** (created inside store settings) with a hardcoded access token. This means:

- Only works on ONE store (`codersh-testimonials.myshopify.com`)
- Cannot be installed by other merchants
- Cannot be submitted to Shopify App Store

---

## What's Been Set Up For Deployment

- **Partner account app**: "Codersh-Sections" created via Shopify CLI on `partners.shopify.com` (Partner account: ARVIN / Shopify Codersh)
- **Supabase project**: `codersh-sections` created, URL: `https://ftnntqgwjdwtidbvrhbx.supabase.co`, hosted in Southeast Asia (Singapore)
- CLI may have created a project scaffold — needs clarification

---

## What Still Needs To Be Done (In Order)

1. **Clarify CLI output** — did `shopify app init` create a Remix scaffold or just register the app? Decision needed on whether to use that or wire existing Node.js backend to new Partner app credentials

2. **Set up proper OAuth flow** — so ANY merchant can install the app, not just one hardcoded store. Requires: OAuth redirect handler, session storage, dynamic shop/token per merchant

3. **Switch database from SQLite to PostgreSQL** — connect Prisma to Supabase using the connection string from Supabase → Connect → ORM → Prisma

4. **Deploy backend to Railway** — Node.js backend needs a public HTTPS URL (Shopify requires this)

5. **Deploy frontend to Vercel** — React dashboard needs a public URL

6. **Embed app inside Shopify Admin (App Bridge)** — currently opens as a separate tab; needs to load inside Shopify Admin as an iframe using Shopify App Bridge

7. **Test on multiple stores** — verify OAuth works for a second dev store

8. **Shopify App Store submission** — privacy policy, app listing, screenshots, review process

---

## Important Rules & Preferences

**Technical preferences:**

- Stack: Node.js + Express (NOT Remix) — developer is a React developer, not familiar with Remix
- Database ORM: Prisma (already installed and configured)
- Keep existing backend structure — don't rebuild from scratch, just add OAuth on top
- Frontend: React + Vite (not Next.js)
- Prisma version: **5.x** (NOT 7.x — Prisma 7 removed `url` from schema which caused errors)

**Developer background:**

- Strong React developer, new to Shopify development
- Prefers step-by-step explanations with reasoning, not just commands
- Uses Cursor as primary editor on Windows

**App architecture decision (already made):**

- Using **Theme API injection** (MIT Sections Pro method) — NOT Theme App Extensions
- Theme API injection writes `.liquid` files directly into merchant's theme → sections appear as native standalone sections
- TAE blocks appear under "Apps" container — that approach was rejected

**Sections approach (already decided):**

- Each section is a standalone injectable Liquid file (with optional separate CSS/JS assets)
- T05+ use multi-file approach: liquid references `cws-t05.css` and `cws-t05.js` via `asset_url`
- New sections should use block-based cards (each card has own fields) + image_picker instead of URL inputs

---

## Immediate Next Step

The new agent should ask for:

1. Contents of the folder the CLI created (if it created one)
2. The Partner app Client ID and Client Secret from Dev Dashboard
3. The Supabase PostgreSQL connection string (from Connect → ORM → Prisma)

Then proceed to wire the existing Node.js backend to the new Partner app with proper OAuth.
