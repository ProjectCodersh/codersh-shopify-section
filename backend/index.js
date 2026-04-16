require("dotenv").config();
const crypto = require("crypto");
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

const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = process.env.SCOPES || "write_themes,read_themes";
const HOST = process.env.HOST || "http://localhost:3000";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// In-memory state store: shop -> state string.
// Replaces cookie-based state — cookies are unreliable across the
// Shopify OAuth redirect on HTTPS proxies like Render.
const oauthStateMap = new Map();

app.use(cors());
app.use(express.json());

// ── Root ──────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ message: "Codersh Sections backend is running!" });
});

// ── OAuth Step 1: begin install ───────────────────────────────────────────────
app.get("/auth", (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).send("Missing shop parameter");

  const state = crypto.randomBytes(16).toString("hex");
  oauthStateMap.set(shop, state); // store by shop — no cookies needed

  const redirectUri = `${HOST}/auth/callback`;
  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${API_KEY}` +
    `&scope=${SCOPES}` +
    `&state=${state}` +
    `&redirect_uri=${redirectUri}`;

  res.redirect(installUrl);
});

// ── OAuth Step 2: callback — exchange code for access token ───────────────────
app.get("/auth/callback", async (req, res) => {
  const { shop, code, hmac, state } = req.query;

  // Verify state matches what we stored for this shop
  const savedState = oauthStateMap.get(shop);
  oauthStateMap.delete(shop); // one-time use
  if (!savedState || state !== savedState) {
    return res.status(403).send("State mismatch — possible CSRF attack");
  }

  // Verify HMAC signature from Shopify
  const map = { ...req.query };
  delete map.hmac;
  const message = Object.keys(map)
    .sort()
    .map((k) => `${k}=${map[k]}`)
    .join("&");
  const digest = crypto
    .createHmac("sha256", API_SECRET)
    .update(message)
    .digest("hex");
  if (digest !== hmac) return res.status(403).send("HMAC validation failed");

  try {
    // Exchange the one-time code for a permanent access token
    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      { client_id: API_KEY, client_secret: API_SECRET, code },
    );
    const accessToken = tokenResponse.data.access_token;

    // Save (or update) this shop's session in the database
    await prisma.session.upsert({
      where: { shop },
      update: { accessToken },
      create: { shop, accessToken },
    });

    // Redirect merchant to the app dashboard
    res.redirect(`${FRONTEND_URL}?shop=${shop}`);
  } catch (error) {
    res.status(500).send("OAuth error: " + error.message);
  }
});

// ── Dev helper: seed a session for any store so you can test without OAuth ──────
// Default (no params): seeds the store from .env
//   http://localhost:3000/dev-login
// Custom store+token (to seed a second dev store):
//   http://localhost:3000/dev-login?shop=other-store.myshopify.com&token=shpat_xxx
// REMOVE THIS before going to production.
app.get("/dev-login", async (req, res) => {
  const shop = req.query.shop || process.env.SHOP;
  const accessToken = req.query.token || process.env.SHOPIFY_ACCESS_TOKEN;
  if (!shop || !accessToken)
    return res
      .status(500)
      .json({
        error:
          "Provide ?shop= and ?token= params, or set SHOP + SHOPIFY_ACCESS_TOKEN in .env",
      });

  await prisma.session.upsert({
    where: { shop },
    update: { accessToken },
    create: { shop, accessToken },
  });
  res.json({ success: true, message: `Dev session seeded for ${shop}` });
});

// ── Auth middleware ───────────────────────────────────────────────────────────
// Every protected route calls this to get the shop + token for the request.
async function requireSession(req, res, next) {
  const shop = req.query.shop || req.body?.shop;
  if (!shop) return res.status(400).json({ error: "Missing shop parameter" });

  const session = await prisma.session.findUnique({ where: { shop } });
  if (!session) {
    return res.status(401).json({
      error: "Not installed",
      authUrl: `${HOST}/auth?shop=${shop}`,
    });
  }

  req.shop = shop;
  req.token = session.accessToken;
  next();
}

// ── Store info ────────────────────────────────────────────────────────────────
app.get("/store-info", requireSession, (req, res) => {
  res.json({ shop: req.shop });
});

// ── Get all sections + installed state ───────────────────────────────────────
app.get("/sections", requireSession, async (req, res) => {
  try {
    const installed = await prisma.installedSection.findMany({
      where: { shop: req.shop },
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
app.post("/inject-section", requireSession, async (req, res) => {
  try {
    const { sectionId } = req.body;
    const { shop, token } = req;

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });

    const liquidCode = getSectionLiquid(section.file);

    // Get active theme
    const themesResponse = await axios.get(
      `https://${shop}/admin/api/2025-01/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const activeTheme = themesResponse.data.themes.find(
      (t) => t.role === "main",
    );
    if (!activeTheme)
      return res.status(404).json({ error: "No active theme found" });

    // Inject liquid file
    await axios.put(
      `https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json`,
      { asset: { key: `sections/${section.id}.liquid`, value: liquidCode } },
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      },
    );

    // Inject asset files (CSS, JS) if any
    const assets = getSectionAssets(section.assets || []);
    for (const asset of assets) {
      await axios.put(
        `https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json`,
        { asset: { key: asset.key, value: asset.value } },
        {
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Save to database
    await prisma.installedSection.upsert({
      where: { shop_sectionId: { shop, sectionId: section.id } },
      update: { installedAt: new Date() },
      create: { shop, sectionId: section.id, sectionName: section.name },
    });

    res.json({
      success: true,
      message: `"${section.name}" added to your theme!`,
    });
  } catch (error) {
    // Log full Shopify error to Render logs so we can diagnose scope issues
    console.error("[inject-section] Error:", error.message);
    console.error(
      "[inject-section] Shopify response:",
      JSON.stringify(error.response?.data),
    );
    res.status(500).json({
      error: error.message,
      shopifyError: error.response?.data,
      shopifyStatus: error.response?.status,
    });
  }
});

// ── Remove a section ──────────────────────────────────────────────────────────
app.delete("/remove-section", requireSession, async (req, res) => {
  try {
    const { sectionId } = req.body;
    const { shop, token } = req;

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });

    const themesResponse = await axios.get(
      `https://${shop}/admin/api/2025-01/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const activeTheme = themesResponse.data.themes.find(
      (t) => t.role === "main",
    );

    // Delete liquid from theme
    await axios.delete(
      `https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json?asset[key]=sections/${section.id}.liquid`,
      { headers: { "X-Shopify-Access-Token": token } },
    );

    // Delete asset files too if any
    for (const asset of section.assets || []) {
      await axios
        .delete(
          `https://${shop}/admin/api/2025-01/themes/${activeTheme.id}/assets.json?asset[key]=${asset.key}`,
          { headers: { "X-Shopify-Access-Token": token } },
        )
        .catch(() => {}); // ignore if already deleted
    }

    // Remove from database
    await prisma.installedSection.delete({
      where: { shop_sectionId: { shop, sectionId: section.id } },
    });

    res.json({
      success: true,
      message: `"${section.name}" removed from your theme.`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
