require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");
const {
  SECTIONS,
  getSectionLiquid,
  getSectionAssets,
} = require("./sections/index");

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// ── Local dev credentials (from .env) ────────────────────────────────────────
// These are used while running locally against your one dev store.
// When going public, these get replaced by the OAuth session system below.
const SHOP = process.env.SHOP;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ── Root ──────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ message: "Codersh Sections backend is running!" });
});

// ── Store info ────────────────────────────────────────────────────────────────
// Returns the shop domain so the frontend can build theme editor links.
app.get("/store-info", (_req, res) => {
  res.json({ shop: SHOP });
});

// ── Get all sections + installed state ───────────────────────────────────────
app.get("/sections", async (_req, res) => {
  try {
    const installed = await prisma.installedSection.findMany({
      where: { shop: SHOP },
    });
    const installedIds = installed.map((i) => i.sectionId);
    res.json(
      SECTIONS.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        installed: installedIds.includes(s.id),
      })),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Inject a section into the active theme ────────────────────────────────────
app.post("/inject-section", async (req, res) => {
  try {
    const { sectionId } = req.body;

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });

    const liquidCode = getSectionLiquid(section.file);

    // Get active theme
    const themesResponse = await axios.get(
      `https://${SHOP}/admin/api/2024-01/themes.json`,
      { headers: { "X-Shopify-Access-Token": TOKEN } },
    );
    const activeTheme = themesResponse.data.themes.find(
      (t) => t.role === "main",
    );
    if (!activeTheme)
      return res.status(404).json({ error: "No active theme found" });

    // Inject liquid file
    await axios.put(
      `https://${SHOP}/admin/api/2024-01/themes/${activeTheme.id}/assets.json`,
      { asset: { key: `sections/${section.id}.liquid`, value: liquidCode } },
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      },
    );

    // Inject asset files (CSS, JS) if any
    const assets = getSectionAssets(section.assets || []);
    for (const asset of assets) {
      await axios.put(
        `https://${SHOP}/admin/api/2024-01/themes/${activeTheme.id}/assets.json`,
        { asset: { key: asset.key, value: asset.value } },
        {
          headers: {
            "X-Shopify-Access-Token": TOKEN,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Save to database
    await prisma.installedSection.upsert({
      where: { shop_sectionId: { shop: SHOP, sectionId: section.id } },
      update: { installedAt: new Date() },
      create: { shop: SHOP, sectionId: section.id, sectionName: section.name },
    });

    res.json({
      success: true,
      message: `"${section.name}" added to your theme!`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

// ── Remove a section ──────────────────────────────────────────────────────────
app.delete("/remove-section", async (req, res) => {
  try {
    const { sectionId } = req.body;

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });

    const themesResponse = await axios.get(
      `https://${SHOP}/admin/api/2024-01/themes.json`,
      { headers: { "X-Shopify-Access-Token": TOKEN } },
    );
    const activeTheme = themesResponse.data.themes.find(
      (t) => t.role === "main",
    );

    // Delete liquid from theme
    await axios.delete(
      `https://${SHOP}/admin/api/2024-01/themes/${activeTheme.id}/assets.json?asset[key]=sections/${section.id}.liquid`,
      { headers: { "X-Shopify-Access-Token": TOKEN } },
    );

    // Delete asset files too if any
    const assets = section.assets || [];
    for (const asset of assets) {
      await axios
        .delete(
          `https://${SHOP}/admin/api/2024-01/themes/${activeTheme.id}/assets.json?asset[key]=${asset.key}`,
          { headers: { "X-Shopify-Access-Token": TOKEN } },
        )
        .catch(() => {}); // ignore if already deleted
    }

    // Remove from database
    await prisma.installedSection.delete({
      where: { shop_sectionId: { shop: SHOP, sectionId: section.id } },
    });

    res.json({
      success: true,
      message: `"${section.name}" removed from your theme.`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// PRODUCTION OAuth CODE — commented out, NOT ready yet.
// Uncomment and wire up when deploying with a real Partner account.
// =============================================================================
//
// const crypto = require("crypto");
//
// const API_KEY    = process.env.SHOPIFY_API_KEY;
// const API_SECRET = process.env.SHOPIFY_API_SECRET;
// const SCOPES     = process.env.SCOPES || "write_themes,read_themes";
// const HOST       = process.env.HOST   || "http://localhost:3000";
//
// // Helper: look up a saved session for a shop
// async function getSession(shop) {
//   return await prisma.session.findUnique({ where: { shop } });
// }
//
// // Middleware: ensure the request comes from a shop that has installed the app
// async function requireSession(req, res, next) {
//   const shop = req.query.shop || req.body.shop;
//   if (!shop) return res.status(400).json({ error: "Missing shop parameter" });
//   const session = await getSession(shop);
//   if (!session) {
//     return res.status(401).json({
//       error: "Not installed",
//       authUrl: `${HOST}/auth?shop=${shop}`,
//     });
//   }
//   req.shop  = shop;
//   req.token = session.accessToken;
//   next();
// }
//
// // Step 1 — Begin OAuth: redirect merchant to Shopify authorization page
// app.get("/auth", (req, res) => {
//   const { shop } = req.query;
//   if (!shop) return res.status(400).send("Missing shop parameter");
//   const state       = crypto.randomBytes(16).toString("hex");
//   const redirectUri = `${HOST}/auth/callback`;
//   const installUrl  =
//     `https://${shop}/admin/oauth/authorize` +
//     `?client_id=${API_KEY}` +
//     `&scope=${SCOPES}` +
//     `&state=${state}` +
//     `&redirect_uri=${redirectUri}`;
//   res.cookie("state", state);
//   res.redirect(installUrl);
// });
//
// // Step 2 — OAuth Callback: exchange code for permanent access token
// app.get("/auth/callback", async (req, res) => {
//   const { shop, code, hmac } = req.query;
//   // Verify HMAC from Shopify
//   const map = { ...req.query };
//   delete map.hmac;
//   const message = Object.keys(map).sort().map((k) => `${k}=${map[k]}`).join("&");
//   const digest  = crypto.createHmac("sha256", API_SECRET).update(message).digest("hex");
//   if (digest !== hmac) return res.status(403).send("HMAC validation failed");
//   // Exchange code for token
//   try {
//     const tokenResponse = await axios.post(
//       `https://${shop}/admin/oauth/access_token`,
//       { client_id: API_KEY, client_secret: API_SECRET, code },
//     );
//     const accessToken = tokenResponse.data.access_token;
//     await prisma.session.upsert({
//       where:  { shop },
//       update: { accessToken },
//       create: { shop, accessToken },
//     });
//     res.redirect(`${HOST}/app?shop=${shop}`);
//   } catch (error) {
//     res.status(500).send("OAuth error: " + error.message);
//   }
// });
//
// // Dev helper — seeds a local session so you can test without going through OAuth.
// // Remove before production deploy.
// // app.get("/dev-login", async (_req, res) => {
// //   const shop        = process.env.SHOP;
// //   const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
// //   if (!shop || !accessToken)
// //     return res.status(500).json({ error: "SHOP or SHOPIFY_ACCESS_TOKEN not set in .env" });
// //   await prisma.session.upsert({
// //     where:  { shop },
// //     update: { accessToken },
// //     create: { shop, accessToken },
// //   });
// //   res.json({ success: true, message: `Dev session seeded for ${shop}` });
// // });
// =============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
