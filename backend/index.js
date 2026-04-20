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

app.use(cors());
app.use(express.json());

// ── Root ──────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ message: "Codersh Sections backend is running!" });
});

// ── OAuth Step 1: begin install ───────────────────────────────────────────────
// State is persisted in the DB (keyed by "oauth-state:<shop>") so server
// restarts and multi-instance Render deploys can't cause CSRF false-positives.
app.get("/auth", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).send("Missing shop parameter");

  const state = crypto.randomBytes(16).toString("hex");
  const stateShop = `oauth-state:${shop}`;

  await prisma.session.upsert({
    where: { shop: stateShop },
    update: { accessToken: state, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    create: { shop: stateShop, accessToken: state, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  });

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

  // Read state from DB and delete it (one-time use)
  const stateShop = `oauth-state:${shop}`;
  const stateRecord = await prisma.session.findUnique({ where: { shop: stateShop } });
  await prisma.session.delete({ where: { shop: stateShop } }).catch(() => {});

  if (!stateRecord || state !== stateRecord.accessToken) {
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
    // Exchange code for an expiring offline token.
    // expiring=1 is mandatory for new public apps after April 2026.
    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      { client_id: API_KEY, client_secret: API_SECRET, code, expiring: 1 },
    );
    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in,
    } = tokenResponse.data;

    console.log("[oauth-callback] token prefix:", accessToken?.slice(0, 8), "has refresh:", !!refreshToken);

    // expires_in is 3600 (1 hour) for expiring tokens
    const expiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.session.upsert({
      where: { shop },
      update: { accessToken, refreshToken: refreshToken || null, expiresAt },
      create: { shop, accessToken, refreshToken: refreshToken || null, expiresAt },
    });

    res.redirect(`${FRONTEND_URL}?shop=${shop}`);
  } catch (error) {
    console.error("[oauth-callback] error:", error.message, JSON.stringify(error.response?.data));
    res.status(500).send("OAuth error: " + error.message);
  }
});

// ── Offline token helper — refreshes if expired ───────────────────────────────
// Always call this before making Admin API requests. Returns a valid shpat_ token.
async function getValidOfflineToken(shop) {
  const session = await prisma.session.findUnique({ where: { shop } });
  if (!session) throw new Error(`No session found for ${shop}. App not installed.`);

  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const isExpired = session.expiresAt && session.expiresAt <= fiveMinFromNow;

  if (!isExpired) return session.accessToken;

  // Token is about to expire — use refresh token to get a new one
  if (!session.refreshToken) {
    throw new Error("Offline token expired and no refresh token available. Merchant must reinstall the app.");
  }

  console.log("[token-refresh] refreshing offline token for", shop);
  const { data } = await axios.post(
    `https://${shop}/admin/oauth/access_token`,
    {
      client_id: API_KEY,
      client_secret: API_SECRET,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    },
  );

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : new Date(Date.now() + 60 * 60 * 1000);

  await prisma.session.update({
    where: { shop },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || session.refreshToken,
      expiresAt,
    },
  });

  console.log("[token-refresh] new token prefix:", data.access_token?.slice(0, 8));
  return data.access_token;
}

// ── Dev helper: seed a session for any store so you can test without OAuth ──────
app.get("/dev-login", async (req, res) => {
  const shop = req.query.shop || process.env.SHOP;
  const accessToken = req.query.token || process.env.SHOPIFY_ACCESS_TOKEN;
  if (!shop || !accessToken)
    return res.status(500).json({
      error:
        "Provide ?shop= and ?token= params, or set SHOP + SHOPIFY_ACCESS_TOKEN in .env",
    });

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.session.upsert({
    where: { shop },
    update: { accessToken, expiresAt },
    create: { shop, accessToken, expiresAt },
  });
  res.json({ success: true, message: `Dev session seeded for ${shop}` });
});

// ── Auth middleware ───────────────────────────────────────────────────────────
async function requireSession(req, res, next) {
  const shop = req.query.shop || req.body?.shop;
  if (!shop) return res.status(400).json({ error: "Missing shop parameter" });

  const sessionToken = req.headers["x-shopify-session-token"];

  // ── Embedded context: App Bridge session token present ────────────────────
  if (sessionToken) {
    try {
      // Exchange App Bridge JWT for an online token (authenticates this request)
      const { data: onlineData } = await axios.post(
        `https://${shop}/admin/oauth/access_token`,
        {
          client_id: API_KEY,
          client_secret: API_SECRET,
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token: sessionToken,
          subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
          requested_token_type: "urn:shopify:params:oauth:token-type:online-access-token",
        },
      );
      console.log("[token-exchange] online token prefix:", onlineData.access_token?.slice(0, 8));
      req.shop = shop;
      req.token = onlineData.access_token;

      // Persist an offline token to DB so getValidOfflineToken works.
      // Only fetch if we don't already have a valid one stored.
      const existing = await prisma.session.findUnique({ where: { shop } });
      const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
      const needsOfflineToken = !existing || (existing.expiresAt && existing.expiresAt <= fiveMinFromNow);

      if (needsOfflineToken) {
        const { data: offlineData } = await axios.post(
          `https://${shop}/admin/oauth/access_token`,
          {
            client_id: API_KEY,
            client_secret: API_SECRET,
            grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
            subject_token: sessionToken,
            subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
            requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
            expiring: 1,
          },
        );
        console.log("[token-exchange] offline token prefix:", offlineData.access_token?.slice(0, 8), "has refresh:", !!offlineData.refresh_token);
        const expiresAt = offlineData.expires_in
          ? new Date(Date.now() + offlineData.expires_in * 1000)
          : new Date(Date.now() + 24 * 60 * 60 * 1000);
        await prisma.session.upsert({
          where: { shop },
          update: { accessToken: offlineData.access_token, refreshToken: offlineData.refresh_token || null, expiresAt },
          create: { shop, accessToken: offlineData.access_token, refreshToken: offlineData.refresh_token || null, expiresAt },
        });
      }

      return next();
    } catch (err) {
      console.error("[token-exchange] failed:", err.message, JSON.stringify(err.response?.data));
      return res.status(401).json({
        error: "Token exchange failed",
        details: err.response?.data,
      });
    }
  }

  // ── Non-embedded context: dev-login / local dev (no App Bridge) ───────────
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
    const { shop } = req;

    // Always use the offline token (shpat_) for Admin API theme writes.
    // getValidOfflineToken handles automatic refresh if the token has expired.
    const token = await getValidOfflineToken(shop);

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });

    const liquidCode = getSectionLiquid(section.file);

    // Get active theme
    const themesResponse = await axios.get(
      `https://${shop}/admin/api/2025-07/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const activeTheme = themesResponse.data.themes.find(
      (t) => t.role === "main",
    );
    if (!activeTheme)
      return res.status(404).json({ error: "No active theme found" });

    // Inject liquid file
    await axios.put(
      `https://${shop}/admin/api/2025-07/themes/${activeTheme.id}/assets.json`,
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
        `https://${shop}/admin/api/2025-07/themes/${activeTheme.id}/assets.json`,
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
    const { shop } = req;

    const token = await getValidOfflineToken(shop);

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });

    const themesResponse = await axios.get(
      `https://${shop}/admin/api/2025-07/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const activeTheme = themesResponse.data.themes.find(
      (t) => t.role === "main",
    );

    // Delete liquid from theme (ignore 404 — file may not exist in theme)
    await axios
      .delete(
        `https://${shop}/admin/api/2025-07/themes/${activeTheme.id}/assets.json?asset[key]=sections/${section.id}.liquid`,
        { headers: { "X-Shopify-Access-Token": token } },
      )
      .catch((err) => {
        if (err.response?.status !== 404) throw err;
      });

    // Delete asset files too if any
    for (const asset of section.assets || []) {
      await axios
        .delete(
          `https://${shop}/admin/api/2025-07/themes/${activeTheme.id}/assets.json?asset[key]=${asset.key}`,
          { headers: { "X-Shopify-Access-Token": token } },
        )
        .catch(() => {});
    }

    // Remove from database
    await prisma.installedSection
      .delete({
        where: { shop_sectionId: { shop, sectionId: section.id } },
      })
      .catch(() => {});

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
