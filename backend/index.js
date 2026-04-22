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
const API_VER = "2025-01";

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE — Modern Shopify Embedded App (Token Exchange, 2025+)
//
// The Dev Dashboard warning "deprecated offline tokens" means the old OAuth
// offline token flow is flagged. The fix: use Token Exchange with
// requested_token_type = offline-access-token. This gives a proper offline
// token scoped to the store, without the deprecation flag.
//
// Flow:
//   1. App Bridge sends a session token (JWT) with every request
//   2. Backend POSTs Token Exchange → gets fresh offline token
//   3. Offline token is used for Shopify Admin API (theme assets etc.)
//   4. OAuth is only needed once for initial install/scope approval
// ─────────────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({ message: "Codersh Sections backend is running!" });
});

// ── OAuth Step 1: Initial install ─────────────────────────────────────────────
app.get("/auth", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).send("Missing shop parameter");

  const state = crypto.randomBytes(16).toString("hex");
  const stateShop = "oauth-state:" + shop;

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

  const redirectUri = HOST + "/auth/callback";
  const installUrl =
    "https://" +
    shop +
    "/admin/oauth/authorize" +
    "?client_id=" +
    API_KEY +
    "&scope=" +
    SCOPES +
    "&state=" +
    state +
    "&redirect_uri=" +
    redirectUri +
    "&expiring=1";

  res.redirect(installUrl);
});

// ── OAuth Step 2: Callback ────────────────────────────────────────────────────
app.get("/auth/callback", async (req, res) => {
  const { shop, code, hmac, state } = req.query;

  const stateShop = "oauth-state:" + shop;
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
    .map((k) => k + "=" + map[k])
    .join("&");
  const digest = crypto
    .createHmac("sha256", API_SECRET)
    .update(message)
    .digest("hex");
  if (digest !== hmac) return res.status(403).send("HMAC validation failed");

  try {
    // Get offline token via OAuth code exchange (initial install only)
    const tokenResponse = await axios.post(
      "https://" + shop + "/admin/oauth/access_token",
      { client_id: API_KEY, client_secret: API_SECRET, code, expiring: 1 },
    );

    const { access_token: accessToken, expires_in: expiresIn } =
      tokenResponse.data;
    console.log(
      "[oauth] token prefix:",
      accessToken && accessToken.slice(0, 10),
    );
    console.log("[oauth] expiring:", !!expiresIn);

    // Save OAuth token to DB — Token Exchange in requireSession will replace
    // it with a proper online token on the first embedded request.
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null;
    await prisma.session.upsert({
      where: { shop },
      update: { accessToken, refreshToken: null, expiresAt },
      create: { shop, accessToken, refreshToken: null, expiresAt },
    });

    console.log("[oauth] session saved for:", shop, "| expiring:", !!expiresAt);
    res.redirect(FRONTEND_URL + "?shop=" + shop);
  } catch (error) {
    console.error(
      "[oauth] error:",
      error.message,
      JSON.stringify(error.response && error.response.data),
    );
    res.status(500).send("OAuth error: " + error.message);
  }
});

// ── Token Exchange: App Bridge JWT → online access token ─────────────────────
// Online tokens are always expiring and work for all Admin API calls including
// write_themes. No Partner Dashboard enrollment needed. App Bridge sends a
// fresh session token with every embedded request, so we can always re-exchange
// when the online token expires.
async function exchangeToken(shop, sessionToken) {
  const { data } = await axios.post(
    "https://" + shop + "/admin/oauth/access_token",
    {
      client_id: API_KEY,
      client_secret: API_SECRET,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type:
        "urn:shopify:params:oauth:token-type:online-access-token",
    },
  );
  return data;
}

// ── Auth middleware ───────────────────────────────────────────────────────────
async function requireSession(req, res, next) {
  const shop = req.query.shop || (req.body && req.body.shop);
  if (!shop) return res.status(400).json({ error: "Missing shop parameter" });

  // ── Step 1: Use cached token if still valid ───────────────────────────────
  // Online tokens are always expiring. Use the DB copy to avoid a Token
  // Exchange round-trip on every request within the same session window.
  const session = await prisma.session.findUnique({ where: { shop } });
  const now = new Date();
  const dbTokenValid =
    session &&
    session.accessToken &&
    session.expiresAt &&
    session.expiresAt > now;

  if (dbTokenValid) {
    console.log(
      "[auth] using cached token prefix:",
      session.accessToken && session.accessToken.slice(0, 10),
      "| expiresAt:",
      session.expiresAt,
    );
    req.shop = shop;
    req.token = session.accessToken;
    return next();
  }

  // ── Step 2: No valid DB token — try Token Exchange with App Bridge JWT ─────
  const sessionToken = req.headers["x-shopify-session-token"];

  if (sessionToken) {
    try {
      const exchangeData = await exchangeToken(shop, sessionToken);
      const accessToken = exchangeData.access_token;
      // Online tokens always include expires_in; store it so Step 1 reuses
      // the cached token on subsequent requests within the same session.
      const expiresAt = exchangeData.expires_in
        ? new Date(Date.now() + exchangeData.expires_in * 1000)
        : null;

      console.log(
        "[auth] token exchange prefix:",
        accessToken && accessToken.slice(0, 10),
        "| expires_in:",
        exchangeData.expires_in || "NON-EXPIRING",
        "| associated_user:",
        exchangeData.associated_user && exchangeData.associated_user.email,
      );

      if (!accessToken) {
        return res.status(401).json({
          error: "Token Exchange returned no token.",
          authUrl: HOST + "/auth?shop=" + shop,
        });
      }

      await prisma.session
        .upsert({
          where: { shop },
          update: { accessToken, refreshToken: null, expiresAt },
          create: { shop, accessToken, refreshToken: null, expiresAt },
        })
        .catch((e) =>
          console.warn("[auth] DB cache update failed:", e.message),
        );

      req.shop = shop;
      req.token = accessToken;
      return next();
    } catch (err) {
      console.error(
        "[auth] token exchange failed:",
        err.message,
        JSON.stringify(err.response && err.response.data),
      );
      return res.status(401).json({
        error: "Token Exchange failed. Please reinstall the app.",
        authUrl: HOST + "/auth?shop=" + shop,
        details: err.message,
      });
    }
  }

  // ── Step 3: No session token header and no cached token ──────────────────
  // This should not happen in a properly embedded app — App Bridge always
  // sends x-shopify-session-token. Reaching here means the request came from
  // outside the Shopify admin (e.g. direct API call without the header).
  return res.status(401).json({
    error: "Missing session token. Open this app from the Shopify admin.",
    authUrl: HOST + "/auth?shop=" + shop,
  });
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
    console.log("[inject] token prefix:", token && token.slice(0, 10));

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section)
      return res.status(404).json({ error: "Section not found in app" });

    const liquidCode = getSectionLiquid(section.file);

    // Fetch themes
    let themesResponse;
    try {
      themesResponse = await axios.get(
        "https://" + shop + "/admin/api/" + API_VER + "/themes.json",
        { headers: { "X-Shopify-Access-Token": token } },
      );
    } catch (err) {
      console.error(
        "[inject] themes fetch failed:",
        err.message,
        JSON.stringify(err.response && err.response.data),
      );
      return res.status(500).json({
        error: "Failed to fetch themes: " + err.message,
        shopifyStatus: err.response && err.response.status,
        shopifyError: err.response && err.response.data,
      });
    }

    const themes = themesResponse.data.themes || [];
    const activeTheme = themes.find((t) => t.role === "main");

    console.log(
      "[inject] themes:",
      themes
        .map(
          (t) => t.name + "(" + t.role + ",locked=" + !!t.theme_store_id + ")",
        )
        .join(", "),
    );

    if (!activeTheme) {
      return res.status(404).json({ error: "No published theme found." });
    }

    // Shopify blocks ALL API writes to Theme Store themes (theme_store_id set).
    // Build a priority-ordered list of writable candidate themes:
    //   1. Active theme if not from Theme Store
    //   2. All other non-Theme-Store themes (unpublished custom/uploaded themes)
    // We try each in order and use the first one that accepts a write.
    const writableCandidates = [
      ...(!activeTheme.theme_store_id ? [activeTheme] : []),
      ...themes.filter((t) => !t.theme_store_id && t.id !== activeTheme.id),
    ];

    if (writableCandidates.length === 0) {
      return res.status(422).json({
        error:
          "Your active theme is from the Shopify Theme Store and cannot be modified by apps via the API.",
        fix: "Upload a custom theme: Themes → Add theme → Upload zip file.",
        themes: themes.map((t) => ({
          id: t.id,
          name: t.name,
          role: t.role,
          writable: !t.theme_store_id,
        })),
      });
    }

    const sectionKey = "sections/" + section.id + ".liquid";
    let targetTheme = null;
    let lastPutErr = null;

    for (const candidate of writableCandidates) {
      console.log(
        "[inject] trying theme:",
        candidate.name,
        "id:",
        candidate.id,
      );
      try {
        await axios.put(
          "https://" +
            shop +
            "/admin/api/" +
            API_VER +
            "/themes/" +
            candidate.id +
            "/assets.json",
          { asset: { key: sectionKey, value: liquidCode } },
          {
            headers: {
              "X-Shopify-Access-Token": token,
              "Content-Type": "application/json",
            },
          },
        );
        targetTheme = candidate;
        console.log(
          "[inject] liquid uploaded to:",
          candidate.name,
          "→",
          sectionKey,
        );
        break;
      } catch (err) {
        console.warn(
          "[inject] PUT failed for theme:",
          candidate.name,
          "status:",
          err.response && err.response.status,
          JSON.stringify(err.response && err.response.data),
        );
        lastPutErr = err;
      }
    }

    if (!targetTheme) {
      // All candidates failed
      console.error("[inject] all theme write attempts failed");
      return res.status(500).json({
        error:
          "Failed to write section file: " + (lastPutErr && lastPutErr.message),
        shopifyError:
          lastPutErr && lastPutErr.response && lastPutErr.response.data,
        shopifyStatus:
          lastPutErr && lastPutErr.response && lastPutErr.response.status,
        triedThemes: writableCandidates.map((t) => ({
          id: t.id,
          name: t.name,
        })),
      });
    }

    // Write CSS/JS assets
    const assets = getSectionAssets(section.assets || []);
    for (const asset of assets) {
      await axios
        .put(
          "https://" +
            shop +
            "/admin/api/" +
            API_VER +
            "/themes/" +
            targetTheme.id +
            "/assets.json",
          { asset: { key: asset.key, value: asset.value } },
          {
            headers: {
              "X-Shopify-Access-Token": token,
              "Content-Type": "application/json",
            },
          },
        )
        .catch((e) =>
          console.error("[inject] asset failed:", asset.key, e.message),
        );
      console.log("[inject] asset uploaded:", asset.key);
    }

    // Save to DB
    await prisma.installedSection.upsert({
      where: { shop_sectionId: { shop, sectionId: section.id } },
      update: { installedAt: new Date() },
      create: { shop, sectionId: section.id, sectionName: section.name },
    });

    const isActive = targetTheme.id === activeTheme.id;
    res.json({
      success: true,
      message: isActive
        ? '"' + section.name + '" added to your theme successfully!'
        : '"' +
          section.name +
          '" added to "' +
          targetTheme.name +
          '". To use it, publish this theme.',
      targetTheme: { id: targetTheme.id, name: targetTheme.name },
      installedToActiveTheme: isActive,
    });
  } catch (error) {
    console.error("[inject] unexpected error:", error.message);
    res.status(500).json({ error: error.message });
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
      "https://" + shop + "/admin/api/" + API_VER + "/themes.json",
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const themes = themesResponse.data.themes || [];

    for (const theme of themes) {
      await axios
        .delete(
          "https://" +
            shop +
            "/admin/api/" +
            API_VER +
            "/themes/" +
            theme.id +
            "/assets.json?asset[key]=sections/" +
            section.id +
            ".liquid",
          { headers: { "X-Shopify-Access-Token": token } },
        )
        .catch(() => {});

      for (const asset of section.assets || []) {
        await axios
          .delete(
            "https://" +
              shop +
              "/admin/api/" +
              API_VER +
              "/themes/" +
              theme.id +
              "/assets.json?asset[key]=" +
              asset.key,
            { headers: { "X-Shopify-Access-Token": token } },
          )
          .catch(() => {});
      }
    }

    await prisma.installedSection
      .delete({ where: { shop_sectionId: { shop, sectionId: section.id } } })
      .catch(() => {});

    res.json({ success: true, message: '"' + section.name + '" removed.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Debug endpoints ───────────────────────────────────────────────────────────
app.get("/debug-session", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Missing shop" });
  const session = await prisma.session.findUnique({ where: { shop } });
  if (!session) return res.json({ found: false });
  res.json({
    found: true,
    tokenPrefix: session.accessToken && session.accessToken.slice(0, 10),
    hasRefreshToken: !!session.refreshToken,
    expiresAt: session.expiresAt,
    isExpired: session.expiresAt ? session.expiresAt <= new Date() : false,
    isNonExpiring: !session.expiresAt,
  });
});

app.get("/test-token", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Missing shop" });
  const session = await prisma.session.findUnique({ where: { shop } });
  if (!session) return res.status(401).json({ error: "No session." });
  try {
    const token = session.accessToken;
    const response = await axios.get(
      "https://" + shop + "/admin/api/" + API_VER + "/themes.json",
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const themes = response.data.themes || [];
    res.json({
      success: true,
      tokenPrefix: token && token.slice(0, 10),
      themesCount: themes.length,
      themes: themes.map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        theme_store_id: t.theme_store_id || null,
        isLocked: !!t.theme_store_id,
      })),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      shopifyStatus: err.response && err.response.status,
    });
  }
});

app.get("/debug-theme", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Missing shop" });
  const session = await prisma.session.findUnique({ where: { shop } });
  if (!session) return res.status(401).json({ error: "No session." });

  const token = session.accessToken;
  try {
    const themesRes = await axios.get(
      "https://" + shop + "/admin/api/" + API_VER + "/themes.json",
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const themes = themesRes.data.themes || [];
    const activeTheme = themes.find((t) => t.role === "main");
    const writableTheme = themes.find((t) => !t.theme_store_id);

    let writeTest = { success: false, skipped: !writableTheme };
    if (writableTheme) {
      try {
        const testKey = "snippets/cws-write-test.liquid";
        await axios.put(
          "https://" +
            shop +
            "/admin/api/" +
            API_VER +
            "/themes/" +
            writableTheme.id +
            "/assets.json",
          {
            asset: {
              key: testKey,
              value: "{%- comment -%}test{%- endcomment -%}",
            },
          },
          {
            headers: {
              "X-Shopify-Access-Token": token,
              "Content-Type": "application/json",
            },
          },
        );
        await axios
          .delete(
            "https://" +
              shop +
              "/admin/api/" +
              API_VER +
              "/themes/" +
              writableTheme.id +
              "/assets.json?asset[key]=" +
              testKey,
            { headers: { "X-Shopify-Access-Token": token } },
          )
          .catch(() => {});
        writeTest = { success: true, testedOn: writableTheme.name };
      } catch (e) {
        writeTest = {
          success: false,
          status: e.response && e.response.status,
          error: e.response && e.response.data,
        };
      }
    }

    res.json({
      tokenPrefix: token && token.slice(0, 10),
      activeTheme: activeTheme
        ? {
            id: activeTheme.id,
            name: activeTheme.name,
            isLocked: !!activeTheme.theme_store_id,
            theme_store_id: activeTheme.theme_store_id || null,
          }
        : null,
      writableTheme: writableTheme
        ? {
            id: writableTheme.id,
            name: writableTheme.name,
            role: writableTheme.role,
          }
        : null,
      allThemesLocked: !writableTheme,
      writeTest,
      allThemes: themes.map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        isLocked: !!t.theme_store_id,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Migrate existing non-expiring token → expiring (one-shot fix) ─────────────
app.get("/migrate-token", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Missing shop" });
  const session = await prisma.session.findUnique({ where: { shop } });
  if (!session)
    return res.status(401).json({ error: "No session for this shop." });

  const currentToken = session.accessToken;
  const isNonExpiring = !session.expiresAt;
  console.log(
    "[migrate] current prefix:",
    currentToken && currentToken.slice(0, 10),
    "| nonExpiring:",
    isNonExpiring,
  );

  try {
    const migData = await migrateOfflineToken(shop, currentToken);
    if (!migData.expires_in) {
      return res.json({
        success: false,
        message:
          "Shopify returned another non-expiring token. The app may need to be reinstalled.",
        tokenPrefix: migData.access_token && migData.access_token.slice(0, 10),
      });
    }
    const newToken = migData.access_token;
    const newExpiresAt = new Date(Date.now() + migData.expires_in * 1000);
    const newRefreshToken = migData.refresh_token || null;

    await prisma.session.update({
      where: { shop },
      data: {
        accessToken: newToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
      },
    });

    console.log(
      "[migrate] success, new prefix:",
      newToken && newToken.slice(0, 10),
    );
    res.json({
      success: true,
      message: "Token migrated to expiring offline token!",
      oldPrefix: currentToken && currentToken.slice(0, 10),
      newPrefix: newToken && newToken.slice(0, 10),
      expiresAt: newExpiresAt,
      hasRefreshToken: !!newRefreshToken,
    });
  } catch (err) {
    console.error(
      "[migrate] error:",
      err.message,
      JSON.stringify(err.response && err.response.data),
    );
    res.status(500).json({
      success: false,
      error: err.message,
      shopifyError: err.response && err.response.data,
    });
  }
});

app.get("/dev-login", async (req, res) => {
  const { shop, token } = req.query;
  if (!shop || !token)
    return res.status(400).json({ error: "Provide ?shop= and ?token=" });
  await prisma.session.upsert({
    where: { shop },
    update: { accessToken: token, expiresAt: null },
    create: { shop, accessToken: token, refreshToken: null, expiresAt: null },
  });
  res.json({ success: true, message: "Dev session seeded for " + shop });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Server running on http://localhost:" + PORT),
);
