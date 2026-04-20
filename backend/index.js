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

// REST API version for all Shopify calls
const REST_VER = "2024-10";

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
      {
        client_id: API_KEY,
        client_secret: API_SECRET,
        code,
        expiring: 1,
      },
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
  try {
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

    console.log(
      "[token-refresh] done, prefix:",
      data.access_token?.slice(0, 10),
    );
    return data.access_token;
  } catch (refreshErr) {
    console.error("[token-refresh] failed:", refreshErr.message);
    throw new Error("Token refresh failed. Please reinstall the app.");
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────
async function requireSession(req, res, next) {
  const shop = req.query.shop || req.body?.shop;
  if (!shop) return res.status(400).json({ error: "Missing shop parameter" });

  const sessionToken = req.headers["x-shopify-session-token"];

  if (sessionToken) {
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
        "[auth] token exchange verification failed (continuing):",
        err.message,
      );
    }

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

// ── Debug theme ───────────────────────────────────────────────────────────────
// USE THIS to diagnose 404 on asset writes.
// Checks theme_store_id — if set, theme is LOCKED (Theme Store theme).
// Locked themes cannot be modified with write_themes alone.
// FIX: Duplicate the theme in Shopify Admin → publish the copy.
app.get("/debug-theme", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  try {
    const token = await getValidOfflineToken(shop);

    // Get all themes
    const themesRes = await axios.get(
      `https://${shop}/admin/api/${REST_VER}/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const themes = themesRes.data.themes || [];
    const activeTheme = themes.find((t) => t.role === "main");

    if (!activeTheme) {
      return res.json({ error: "No main theme found", themes });
    }

    // Get detailed info for active theme including theme_store_id
    const themeDetailRes = await axios.get(
      `https://${shop}/admin/api/${REST_VER}/themes/${activeTheme.id}.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const themeDetail = themeDetailRes.data.theme;

    // Try a test write to confirm if writable
    let writeTest = null;
    try {
      await axios.put(
        `https://${shop}/admin/api/${REST_VER}/themes/${activeTheme.id}/assets.json`,
        {
          asset: {
            key: "sections/cws-write-test.liquid",
            value: "<!-- test -->",
          },
        },
        {
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
          },
        },
      );
      writeTest = { success: true, message: "Theme is writable!" };

      // Clean up test file
      await axios
        .delete(
          `https://${shop}/admin/api/${REST_VER}/themes/${activeTheme.id}/assets.json?asset[key]=sections/cws-write-test.liquid`,
          { headers: { "X-Shopify-Access-Token": token } },
        )
        .catch(() => {});
    } catch (writeErr) {
      writeTest = {
        success: false,
        status: writeErr.response?.status,
        error: writeErr.response?.data || writeErr.message,
      };
    }

    res.json({
      activeTheme: {
        id: themeDetail.id,
        name: themeDetail.name,
        role: themeDetail.role,
        theme_store_id: themeDetail.theme_store_id,
        isLocked: !!themeDetail.theme_store_id,
        processing: themeDetail.processing,
      },
      writeTest,
      diagnosis: themeDetail.theme_store_id
        ? "⚠️ LOCKED: This is a Shopify Theme Store theme (theme_store_id is set). " +
          "Duplicating the theme removes the lock. Go to: Online Store → Themes → " +
          "click ••• on Horizon → Duplicate → then Publish the copy."
        : "✅ Theme is NOT locked. Write should work. Check token scopes.",
      tokenPrefix: token?.slice(0, 10),
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: err.message, shopifyError: err.response?.data });
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

    // Get active theme
    let activeTheme;
    try {
      const themesResponse = await axios.get(
        `https://${shop}/admin/api/${REST_VER}/themes.json`,
        { headers: { "X-Shopify-Access-Token": token } },
      );
      const themes = themesResponse.data.themes || [];
      console.log(
        "[inject] themes:",
        themes.map((t) => `${t.name}(${t.role})`).join(", "),
      );
      activeTheme = themes.find((t) => t.role === "main");
    } catch (themeErr) {
      console.error("[inject] themes fetch failed:", themeErr.message);
      return res.status(500).json({
        error: "Failed to fetch themes: " + themeErr.message,
        shopifyError: themeErr.response?.data,
      });
    }

    if (!activeTheme) {
      return res
        .status(404)
        .json({ error: "No published (main) theme found." });
    }

    console.log(
      "[inject] active theme:",
      activeTheme.name,
      "id:",
      activeTheme.id,
    );

    // Check if theme is locked (Theme Store theme)
    // theme_store_id being set means Shopify locks direct asset writes
    if (activeTheme.theme_store_id) {
      console.warn(
        "[inject] theme is locked (theme_store_id:",
        activeTheme.theme_store_id,
        ")",
      );
      return res.status(403).json({
        error:
          "Your active theme is a locked Shopify Theme Store theme and cannot be modified directly.",
        fix: "Go to Online Store → Themes → click ••• on your theme → Duplicate → then Publish the copy. The duplicated theme is fully writable.",
        theme_store_id: activeTheme.theme_store_id,
      });
    }

    // Upload .liquid file via REST assets API
    try {
      await axios.put(
        `https://${shop}/admin/api/${REST_VER}/themes/${activeTheme.id}/assets.json`,
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

      // If still 404, tell user to run /debug-theme for diagnosis
      if (putErr.response?.status === 404) {
        return res.status(500).json({
          error: "Failed to write section file (404). The theme may be locked.",
          shopifyError: putErr.response?.data,
          shopifyStatus: 404,
          tokenPrefix: token?.slice(0, 10),
          themeId: activeTheme.id,
          fix: `Run /debug-theme?shop=${shop} to diagnose. If theme is locked, duplicate it in Shopify Admin.`,
        });
      }

      return res.status(500).json({
        error: "Failed to write section file: " + putErr.message,
        shopifyError: putErr.response?.data,
        shopifyStatus: putErr.response?.status,
        tokenPrefix: token?.slice(0, 10),
      });
    }

    // Upload CSS/JS assets if any
    const assets = getSectionAssets(section.assets || []);
    for (const asset of assets) {
      await axios.put(
        `https://${shop}/admin/api/${REST_VER}/themes/${activeTheme.id}/assets.json`,
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
    console.error("[inject] unexpected error:", error.message);
    res
      .status(500)
      .json({ error: error.message, shopifyError: error.response?.data });
  }
});

// ── Remove section ────────────────────────────────────────────────────────────
app.delete("/remove-section", requireSession, async (req, res) => {
  try {
    const { sectionId } = req.body;
    const { shop, token } = req;

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });

    const themesResponse = await axios.get(
      `https://${shop}/admin/api/${REST_VER}/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const activeTheme = themesResponse.data.themes.find(
      (t) => t.role === "main",
    );

    if (activeTheme) {
      await axios
        .delete(
          `https://${shop}/admin/api/${REST_VER}/themes/${activeTheme.id}/assets.json?asset[key]=sections/${section.id}.liquid`,
          { headers: { "X-Shopify-Access-Token": token } },
        )
        .catch((err) => {
          if (err.response?.status !== 404) throw err;
        });

      for (const asset of section.assets || []) {
        await axios
          .delete(
            `https://${shop}/admin/api/${REST_VER}/themes/${activeTheme.id}/assets.json?asset[key]=${asset.key}`,
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

// ── Test token ────────────────────────────────────────────────────────────────
app.get("/test-token", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Missing shop" });

  try {
    const token = await getValidOfflineToken(shop);
    const response = await axios.get(
      `https://${shop}/admin/api/${REST_VER}/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const themes = response.data.themes || [];
    res.json({
      success: true,
      tokenPrefix: token?.slice(0, 10),
      themesCount: themes.length,
      themes: themes.map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        theme_store_id: t.theme_store_id,
        isLocked: !!t.theme_store_id,
      })),
      hint: themes.some((t) => t.theme_store_id && t.role === "main")
        ? "⚠️ Your active theme is locked. Duplicate it in Shopify Admin to make it writable."
        : "✅ Active theme is writable.",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      shopifyError: err.response?.data,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
