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

app.get("/", (_req, res) => {
  res.json({ message: "Codersh Sections backend is running!" });
});

// ── OAuth Step 1 ──────────────────────────────────────────────────────────────
app.get("/auth", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).send("Missing shop parameter");

  const state = crypto.randomBytes(16).toString("hex");
  const stateShop = `oauth-state:${shop}`;

  await prisma.session.upsert({
    where: { shop: stateShop },
    update: {
      accessToken: state,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
    create: {
      shop: stateShop,
      accessToken: state,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
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

// ── OAuth Step 2 ──────────────────────────────────────────────────────────────
app.get("/auth/callback", async (req, res) => {
  const { shop, code, hmac, state } = req.query;

  const stateShop = `oauth-state:${shop}`;
  const stateRecord = await prisma.session.findUnique({
    where: { shop: stateShop },
  });
  await prisma.session.delete({ where: { shop: stateShop } }).catch(() => {});

  if (!stateRecord || state !== stateRecord.accessToken) {
    return res.status(403).send("State mismatch");
  }

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
    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      { client_id: API_KEY, client_secret: API_SECRET, code },
    );

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in,
    } = tokenResponse.data;

    console.log(
      "[oauth-callback] response keys:",
      Object.keys(tokenResponse.data),
    );
    console.log("[oauth-callback] token prefix:", accessToken?.slice(0, 10));
    console.log(
      "[oauth-callback] has refresh:",
      !!refreshToken,
      "expires_in:",
      expires_in,
    );

    const expiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000)
      : null;

    await prisma.session.upsert({
      where: { shop },
      update: { accessToken, refreshToken: refreshToken || null, expiresAt },
      create: {
        shop,
        accessToken,
        refreshToken: refreshToken || null,
        expiresAt,
      },
    });

    console.log("[oauth-callback] session saved for:", shop);
    res.redirect(`${FRONTEND_URL}?shop=${shop}`);
  } catch (error) {
    console.error(
      "[oauth-callback] error:",
      error.message,
      JSON.stringify(error.response?.data),
    );
    res.status(500).send("OAuth error: " + error.message);
  }
});

// ── Get valid offline token ───────────────────────────────────────────────────
async function getValidOfflineToken(shop) {
  const session = await prisma.session.findUnique({ where: { shop } });
  if (!session)
    throw new Error(`No session for ${shop}. Please reinstall the app.`);

  // Non-expiring token (legacy) — use as-is
  if (!session.expiresAt) {
    console.log("[token] using non-expiring token for:", shop);
    return session.accessToken;
  }

  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (session.expiresAt > fiveMinFromNow) {
    console.log("[token] token still valid for:", shop);
    return session.accessToken;
  }

  if (!session.refreshToken) {
    throw new Error(
      "Token expired and no refresh token. Please reinstall the app.",
    );
  }

  console.log("[token-refresh] refreshing for:", shop);
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
    : null;
  await prisma.session.update({
    where: { shop },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || session.refreshToken,
      expiresAt,
    },
  });

  console.log("[token-refresh] done, prefix:", data.access_token?.slice(0, 10));
  return data.access_token;
}

// ── Auth middleware ───────────────────────────────────────────────────────────
// KEY FIX: We use Token Exchange ONLY to verify the user is logged in.
// We ALWAYS use the OFFLINE token for actual Shopify Admin API calls.
// This is because:
// - Online tokens (from Token Exchange) are user-scoped and cannot reliably write themes
// - Offline tokens are store-scoped and have full write_themes permission
// - Theme asset writes (PUT /themes/{id}/assets.json) require offline store token
async function requireSession(req, res, next) {
  const shop = req.query.shop || req.body?.shop;
  if (!shop) return res.status(400).json({ error: "Missing shop parameter" });

  const sessionToken = req.headers["x-shopify-session-token"];

  if (sessionToken) {
    // STEP 1: Verify user via Token Exchange (just for auth check)
    try {
      await axios.post(`https://${shop}/admin/oauth/access_token`, {
        client_id: API_KEY,
        client_secret: API_SECRET,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: sessionToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type:
          "urn:shopify:params:oauth:token-type:online-access-token",
      });
      console.log("[auth] user verified via token exchange for:", shop);
    } catch (err) {
      console.warn(
        "[auth] token exchange verification failed (continuing anyway):",
        err.message,
      );
      // Don't block — still try offline token below
    }

    // STEP 2: Always use OFFLINE token for actual API calls
    try {
      const offlineToken = await getValidOfflineToken(shop);
      req.shop = shop;
      req.token = offlineToken;
      return next();
    } catch (offlineErr) {
      console.error("[auth] no offline token:", offlineErr.message);
      return res.status(401).json({
        error: "App not properly installed. Please reinstall.",
        authUrl: `${HOST}/auth?shop=${shop}`,
      });
    }
  }

  // NON-EMBEDDED: use offline token directly
  try {
    const token = await getValidOfflineToken(shop);
    req.shop = shop;
    req.token = token;
    return next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: err.message, authUrl: `${HOST}/auth?shop=${shop}` });
  }
}

// ── Store info ────────────────────────────────────────────────────────────────
app.get("/store-info", requireSession, (req, res) => {
  res.json({ shop: req.shop });
});

// ── List sections ─────────────────────────────────────────────────────────────
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

// ── Inject section ────────────────────────────────────────────────────────────
app.post("/inject-section", requireSession, async (req, res) => {
  try {
    const { sectionId } = req.body;
    const { shop, token } = req;

    console.log("[inject] sectionId:", sectionId, "shop:", shop);
    console.log("[inject] token prefix:", token?.slice(0, 10));

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section)
      return res.status(404).json({ error: "Section not found in app" });

    const liquidCode = getSectionLiquid(section.file);

    // Use stable API version 2024-10
    const API_VER = "2024-10";

    // Get active theme
    let themesResponse;
    try {
      themesResponse = await axios.get(
        `https://${shop}/admin/api/${API_VER}/themes.json`,
        { headers: { "X-Shopify-Access-Token": token } },
      );
    } catch (themeErr) {
      console.error(
        "[inject] themes fetch failed:",
        themeErr.message,
        JSON.stringify(themeErr.response?.data),
      );
      return res.status(500).json({
        error: "Failed to fetch themes: " + themeErr.message,
        shopifyError: themeErr.response?.data,
        shopifyStatus: themeErr.response?.status,
        tokenPrefix: token?.slice(0, 10),
        hint:
          themeErr.response?.status === 401
            ? "Token is invalid or expired. Please reinstall the app."
            : themeErr.response?.status === 403
              ? "Token does not have write_themes permission. Please reinstall."
              : "Unexpected error fetching themes.",
      });
    }

    const themes = themesResponse.data.themes || [];
    console.log(
      "[inject] themes found:",
      themes.map((t) => `${t.name}(${t.role})`).join(", "),
    );

    const activeTheme = themes.find((t) => t.role === "main");
    if (!activeTheme) {
      return res
        .status(404)
        .json({ error: "No published (main) theme found on this store." });
    }

    console.log(
      "[inject] writing to theme:",
      activeTheme.name,
      "id:",
      activeTheme.id,
    );

    // Upload .liquid file
    try {
      await axios.put(
        `https://${shop}/admin/api/${API_VER}/themes/${activeTheme.id}/assets.json`,
        { asset: { key: `sections/${section.id}.liquid`, value: liquidCode } },
        {
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
          },
        },
      );
      console.log("[inject] liquid uploaded:", `sections/${section.id}.liquid`);
    } catch (putErr) {
      console.error(
        "[inject] PUT assets failed:",
        putErr.message,
        JSON.stringify(putErr.response?.data),
      );
      return res.status(500).json({
        error: "Failed to write section file: " + putErr.message,
        shopifyError: putErr.response?.data,
        shopifyStatus: putErr.response?.status,
        tokenPrefix: token?.slice(0, 10),
        themeId: activeTheme.id,
        hint:
          putErr.response?.status === 404
            ? "Theme ID was found but assets endpoint returned 404. This usually means the token does not have write permission to this theme."
            : putErr.response?.status === 422
              ? "Liquid file has syntax errors."
              : "Unexpected error uploading section file.",
      });
    }

    // Upload CSS/JS assets if any
    const assets = getSectionAssets(section.assets || []);
    for (const asset of assets) {
      await axios.put(
        `https://${shop}/admin/api/${API_VER}/themes/${activeTheme.id}/assets.json`,
        { asset: { key: asset.key, value: asset.value } },
        {
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
          },
        },
      );
      console.log("[inject] asset uploaded:", asset.key);
    }

    // Save to DB
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
    console.error(
      "[inject] unexpected error:",
      error.message,
      JSON.stringify(error.response?.data),
    );
    res.status(500).json({
      error: error.message,
      shopifyError: error.response?.data,
      shopifyStatus: error.response?.status,
    });
  }
});

// ── Remove section ────────────────────────────────────────────────────────────
app.delete("/remove-section", requireSession, async (req, res) => {
  try {
    const { sectionId } = req.body;
    const { shop, token } = req;
    const API_VER = "2024-10";

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });

    const themesResponse = await axios.get(
      `https://${shop}/admin/api/${API_VER}/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const activeTheme = themesResponse.data.themes.find(
      (t) => t.role === "main",
    );

    if (activeTheme) {
      await axios
        .delete(
          `https://${shop}/admin/api/${API_VER}/themes/${activeTheme.id}/assets.json?asset[key]=sections/${section.id}.liquid`,
          { headers: { "X-Shopify-Access-Token": token } },
        )
        .catch((err) => {
          if (err.response?.status !== 404) throw err;
        });

      for (const asset of section.assets || []) {
        await axios
          .delete(
            `https://${shop}/admin/api/${API_VER}/themes/${activeTheme.id}/assets.json?asset[key]=${asset.key}`,
            { headers: { "X-Shopify-Access-Token": token } },
          )
          .catch(() => {});
      }
    }

    await prisma.installedSection
      .delete({ where: { shop_sectionId: { shop, sectionId: section.id } } })
      .catch(() => {});

    res.json({
      success: true,
      message: `"${section.name}" removed from your theme.`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Dev login ─────────────────────────────────────────────────────────────────
app.get("/dev-login", async (req, res) => {
  const shop = req.query.shop || process.env.SHOP;
  const accessToken = req.query.token || process.env.SHOPIFY_ACCESS_TOKEN;
  if (!shop || !accessToken)
    return res.status(500).json({ error: "Provide ?shop= and ?token= params" });

  await prisma.session.upsert({
    where: { shop },
    update: { accessToken, expiresAt: null },
    create: { shop, accessToken, expiresAt: null },
  });
  res.json({ success: true, message: `Dev session seeded for ${shop}` });
});

// ── Debug session ─────────────────────────────────────────────────────────────
app.get("/debug-session", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Missing shop" });
  const session = await prisma.session.findUnique({ where: { shop } });
  if (!session)
    return res.json({
      found: false,
      message: "No session in DB for this shop",
    });
  res.json({
    found: true,
    tokenPrefix: session.accessToken?.slice(0, 10),
    hasRefreshToken: !!session.refreshToken,
    expiresAt: session.expiresAt,
    isExpired: session.expiresAt ? session.expiresAt <= new Date() : false,
    isNonExpiring: !session.expiresAt,
  });
});

// ── Test token directly (debug only) ─────────────────────────────────────────
// Call this to verify if your stored token can actually read themes
app.get("/test-token", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  try {
    const token = await getValidOfflineToken(shop);
    const response = await axios.get(
      `https://${shop}/admin/api/2024-10/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const themes = response.data.themes || [];
    res.json({
      success: true,
      tokenPrefix: token?.slice(0, 10),
      themesCount: themes.length,
      themes: themes.map((t) => ({ id: t.id, name: t.name, role: t.role })),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      shopifyError: err.response?.data,
      shopifyStatus: err.response?.status,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);

// lasr web based agent commit
