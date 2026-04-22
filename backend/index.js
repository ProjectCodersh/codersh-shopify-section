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

// ── Token Exchange: App Bridge JWT → expiring offline access token ────────────
// Offline tokens are store-level (not tied to a user session) and survive
// browser close — ideal for theme writes. The `expiring: 1` parameter is what
// makes Shopify return an expiring token + refresh token instead of a legacy
// non-expiring token. No Partner Dashboard enrollment needed.
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
        "urn:shopify:params:oauth:token-type:offline-access-token",
      expiring: 1,
    },
  );
  return data;
}

// ── Refresh an expiring offline token using its refresh token ─────────────────
async function refreshOfflineToken(shop, refreshToken) {
  const { data } = await axios.post(
    "https://" + shop + "/admin/oauth/access_token",
    {
      client_id: API_KEY,
      client_secret: API_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
  );
  return data;
}

// ── Auth middleware ───────────────────────────────────────────────────────────
async function requireSession(req, res, next) {
  const shop = req.query.shop || (req.body && req.body.shop);
  if (!shop) return res.status(400).json({ error: "Missing shop parameter" });

  const session = await prisma.session.findUnique({ where: { shop } });
  const now = new Date();

  // ── Step 1: Use cached access token if still valid ────────────────────────
  if (session && session.accessToken && session.expiresAt && session.expiresAt > now) {
    console.log(
      "[auth] using cached token prefix:",
      session.accessToken.slice(0, 10),
      "| expiresAt:",
      session.expiresAt,
    );
    req.shop = shop;
    req.token = session.accessToken;
    return next();
  }

  // ── Step 2: Access token expired — try refresh token ─────────────────────
  if (session && session.refreshToken) {
    try {
      const refreshData = await refreshOfflineToken(shop, session.refreshToken);
      const accessToken = refreshData.access_token;
      const refreshToken = refreshData.refresh_token || session.refreshToken;
      const expiresAt = refreshData.expires_in
        ? new Date(Date.now() + refreshData.expires_in * 1000)
        : null;

      console.log(
        "[auth] refreshed token prefix:",
        accessToken && accessToken.slice(0, 10),
        "| new expiresAt:",
        expiresAt,
      );

      await prisma.session.update({
        where: { shop },
        data: { accessToken, refreshToken, expiresAt },
      });

      req.shop = shop;
      req.token = accessToken;
      return next();
    } catch (err) {
      console.warn(
        "[auth] refresh token failed, falling through to Token Exchange:",
        err.message,
      );
    }
  }

  // ── Step 3: No valid token — Token Exchange with App Bridge session JWT ───
  const sessionToken = req.headers["x-shopify-session-token"];

  if (sessionToken) {
    try {
      const exchangeData = await exchangeToken(shop, sessionToken);
      const accessToken = exchangeData.access_token;
      const refreshToken = exchangeData.refresh_token || null;
      const expiresAt = exchangeData.expires_in
        ? new Date(Date.now() + exchangeData.expires_in * 1000)
        : null;

      console.log(
        "[auth] token exchange prefix:",
        accessToken && accessToken.slice(0, 10),
        "| expires_in:",
        exchangeData.expires_in || "NON-EXPIRING",
        "| has_refresh_token:",
        !!refreshToken,
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
          update: { accessToken, refreshToken, expiresAt },
          create: { shop, accessToken, refreshToken, expiresAt },
        })
        .catch((e) =>
          console.warn("[auth] DB upsert failed:", e.message),
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

  // ── Step 4: No session token header — request came from outside the admin ─
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

    // Try the active theme first — GraphQL themeFilesUpsert may succeed even
    // for Theme Store themes. If it fails, fall through to any other theme.
    const candidates = [
      activeTheme,
      ...themes.filter((t) => t.id !== activeTheme.id),
    ];

    const sectionKey = "sections/" + section.id + ".liquid";
    let targetTheme = null;
    let lastErr = null;

    for (const candidate of candidates) {
      console.log("[inject] trying theme:", candidate.name, "id:", candidate.id);
      const gid = "gid://shopify/OnlineStoreTheme/" + candidate.id;
      try {
        const gqlRes = await axios.post(
          "https://" + shop + "/admin/api/" + API_VER + "/graphql.json",
          {
            query: `mutation themeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
              themeFilesUpsert(themeId: $themeId, files: $files) {
                upsertedThemeFiles { filename }
                userErrors { filename field message }
              }
            }`,
            variables: {
              themeId: gid,
              files: [{ filename: sectionKey, body: { type: "TEXT", value: liquidCode } }],
            },
          },
          { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } },
        );

        const userErrors = gqlRes.data.data &&
          gqlRes.data.data.themeFilesUpsert &&
          gqlRes.data.data.themeFilesUpsert.userErrors;

        if (userErrors && userErrors.length > 0) {
          console.warn("[inject] GraphQL userErrors for", candidate.name, JSON.stringify(userErrors));
          lastErr = new Error(userErrors.map((e) => e.message).join(", "));
          continue;
        }

        targetTheme = candidate;
        console.log("[inject] liquid uploaded via GraphQL to:", candidate.name, "→", sectionKey);
        break;
      } catch (err) {
        console.warn(
          "[inject] GraphQL failed for theme:", candidate.name,
          "status:", err.response && err.response.status,
          JSON.stringify(err.response && err.response.data),
        );
        lastErr = err;
      }
    }

    if (!targetTheme) {
      console.error("[inject] all theme write attempts failed");
      return res.status(500).json({
        error: "Failed to write section file: " + (lastErr && lastErr.message),
        triedThemes: writableCandidates.map((t) => ({ id: t.id, name: t.name })),
      });
    }

    // Write CSS/JS assets via GraphQL
    const assets = getSectionAssets(section.assets || []);
    if (assets.length > 0) {
      const gid = "gid://shopify/OnlineStoreTheme/" + targetTheme.id;
      await axios
        .post(
          "https://" + shop + "/admin/api/" + API_VER + "/graphql.json",
          {
            query: `mutation themeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
              themeFilesUpsert(themeId: $themeId, files: $files) {
                upsertedThemeFiles { filename }
                userErrors { filename field message }
              }
            }`,
            variables: {
              themeId: gid,
              files: assets.map((a) => ({ filename: a.key, body: { type: "TEXT", value: a.value } })),
            },
          },
          { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } },
        )
        .then((r) => {
          const errs = r.data.data && r.data.data.themeFilesUpsert && r.data.data.themeFilesUpsert.userErrors;
          if (errs && errs.length) console.error("[inject] asset GraphQL errors:", JSON.stringify(errs));
          else console.log("[inject] assets uploaded:", assets.map((a) => a.key).join(", "));
        })
        .catch((e) => console.error("[inject] assets upload failed:", e.message));
    }

    // Save to DB
    await prisma.installedSection.upsert({
      where: { shop_sectionId: { shop, sectionId: section.id } },
      update: { installedAt: new Date() },
      create: { shop, sectionId: section.id, sectionName: section.name },
    });

    const isActive = targetTheme.id === activeTheme.id;
    const themeEditorUrl =
      "https://" + shop + "/admin/themes/" + targetTheme.id + "/editor";
    res.json({
      success: true,
      message: isActive
        ? '"' + section.name + '" added to your active theme!'
        : '"' + section.name + '" added to "' + targetTheme.name + '" (not your active theme). Publish it to see it live.',
      targetTheme: { id: targetTheme.id, name: targetTheme.name },
      installedToActiveTheme: isActive,
      themeEditorUrl,
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

app.get("/check-scopes", async (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).json({ error: "Missing shop" });
  const session = await prisma.session.findUnique({ where: { shop } });
  if (!session) return res.status(401).json({ error: "No session." });
  try {
    const response = await axios.post(
      "https://" + shop + "/admin/api/" + API_VER + "/graphql.json",
      {
        query: `{
          currentAppInstallation {
            accessScopes { handle }
          }
        }`,
      },
      { headers: { "X-Shopify-Access-Token": session.accessToken, "Content-Type": "application/json" } },
    );
    const scopes = (
      response.data.data.currentAppInstallation.accessScopes || []
    ).map((s) => s.handle);
    res.json({
      tokenPrefix: session.accessToken && session.accessToken.slice(0, 10),
      grantedScopes: scopes,
      hasReadThemes: scopes.includes("read_themes"),
      hasWriteThemes: scopes.includes("write_themes"),
      verdict: scopes.includes("write_themes")
        ? "OK — token has write_themes"
        : "PROBLEM — write_themes scope is missing. Uninstall and reinstall the app.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message, shopifyError: err.response && err.response.data });
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
