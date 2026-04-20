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

// ─────────────────────────────────────────────────────────────────────────────
// API VERSION STRATEGY:
// - Use 2025-01 for GraphQL (themeFilesUpsert / themeFilesDelete)
// - Use 2025-01 for REST themes list (GET /themes.json)
//
// WHY GRAPHQL for file writes?
// The REST PUT /themes/{id}/assets.json endpoint returns 404 on Shopify 2025+
// for Online Store 2.0 themes (like Horizon). Shopify has moved theme file
// management to the GraphQL Admin API exclusively for newer themes.
// Ref: https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeFilesUpsert
// ─────────────────────────────────────────────────────────────────────────────
const GQL_VER = "2025-01";
const REST_VER = "2025-01";

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
// REQUIRED: expiring=1 tells Shopify to issue an expiring offline token with
// refresh_token. Mandatory for public apps created after April 1, 2026.
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
        expiring: 1, // Required for public apps post April 1 2026
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
    console.error(
      "[token-refresh] failed:",
      refreshErr.message,
      JSON.stringify(refreshErr.response?.data),
    );
    throw new Error("Token refresh failed. Please reinstall the app.");
  }
}

// ── GraphQL helper ────────────────────────────────────────────────────────────
// All theme file writes/deletes use GraphQL — the REST assets API returns 404
// on Online Store 2.0 themes (Horizon etc.) in Shopify 2025+.
async function shopifyGraphQL(shop, token, query, variables = {}) {
  const response = await axios.post(
    `https://${shop}/admin/api/${GQL_VER}/graphql.json`,
    { query, variables },
    {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
    },
  );

  if (response.data.errors) {
    const errMsg = response.data.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL error: ${errMsg}`);
  }

  return response.data.data;
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

// ── Inject section ────────────────────────────────────────────────────────────
// Uses GraphQL themeFilesUpsert — NOT the REST assets API.
// The REST PUT /themes/{id}/assets.json returns 404 on OS2 themes in 2025+.
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

    // ── Step 1: Get active theme via REST (this still works fine) ─────────────
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
        shopifyStatus: themeErr.response?.status,
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

    // ── Step 2: Build GID for GraphQL ─────────────────────────────────────────
    // GraphQL requires the theme ID in GID format
    const themeGid = `gid://shopify/OnlineStoreTheme/${activeTheme.id}`;

    // ── Step 3: Upload .liquid file via GraphQL themeFilesUpsert ─────────────
    const upsertMutation = `
      mutation themeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles {
            filename
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Upload the main liquid file
    try {
      const filesToUpload = [
        {
          filename: `sections/${section.id}.liquid`,
          body: {
            type: "TEXT",
            value: liquidCode,
          },
        },
      ];

      // Also include any CSS/JS assets in the same mutation call
      const sectionAssets = getSectionAssets(section.assets || []);
      for (const asset of sectionAssets) {
        filesToUpload.push({
          filename: asset.key,
          body: {
            type: "TEXT",
            value: asset.value,
          },
        });
      }

      console.log(
        "[inject] uploading files via GraphQL:",
        filesToUpload.map((f) => f.filename),
      );

      const gqlResult = await shopifyGraphQL(shop, token, upsertMutation, {
        themeId: themeGid,
        files: filesToUpload,
      });

      const userErrors = gqlResult?.themeFilesUpsert?.userErrors || [];
      if (userErrors.length > 0) {
        const errorMsg = userErrors
          .map((e) => `${e.field}: ${e.message}`)
          .join("; ");
        console.error("[inject] GraphQL userErrors:", errorMsg);
        return res.status(422).json({
          error: "Shopify rejected the file: " + errorMsg,
          userErrors,
        });
      }

      const upserted = gqlResult?.themeFilesUpsert?.upsertedThemeFiles || [];
      console.log(
        "[inject] successfully uploaded:",
        upserted.map((f) => f.filename),
      );
    } catch (gqlErr) {
      console.error("[inject] GraphQL upsert failed:", gqlErr.message);
      return res.status(500).json({
        error: "Failed to upload section file: " + gqlErr.message,
        hint: "GraphQL themeFilesUpsert failed. Check token scopes and theme access.",
      });
    }

    // ── Step 4: Save to DB ────────────────────────────────────────────────────
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
    res.status(500).json({
      error: error.message,
      shopifyError: error.response?.data,
    });
  }
});

// ── Remove section ────────────────────────────────────────────────────────────
// Uses GraphQL themeFilesDelete — same reason as above.
app.delete("/remove-section", requireSession, async (req, res) => {
  try {
    const { sectionId } = req.body;
    const { shop, token } = req;

    const section = SECTIONS.find((s) => s.id === sectionId);
    if (!section) return res.status(404).json({ error: "Section not found" });

    // Get active theme
    const themesResponse = await axios.get(
      `https://${shop}/admin/api/${REST_VER}/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const activeTheme = themesResponse.data.themes.find(
      (t) => t.role === "main",
    );

    if (activeTheme) {
      const themeGid = `gid://shopify/OnlineStoreTheme/${activeTheme.id}`;

      const deleteMutation = `
        mutation themeFilesDelete($themeId: ID!, $files: [String!]!) {
          themeFilesDelete(themeId: $themeId, files: $files) {
            deletedThemeFiles {
              filename
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // Build list of files to delete
      const filesToDelete = [`sections/${section.id}.liquid`];
      for (const asset of section.assets || []) {
        filesToDelete.push(asset.key);
      }

      try {
        const gqlResult = await shopifyGraphQL(shop, token, deleteMutation, {
          themeId: themeGid,
          files: filesToDelete,
        });
        console.log(
          "[remove] deleted files:",
          gqlResult?.themeFilesDelete?.deletedThemeFiles?.map(
            (f) => f.filename,
          ),
        );
      } catch (gqlErr) {
        // Log but don't fail — file might already be gone
        console.warn(
          "[remove] GraphQL delete failed (continuing):",
          gqlErr.message,
        );
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

    // Test REST themes list
    const restResponse = await axios.get(
      `https://${shop}/admin/api/${REST_VER}/themes.json`,
      { headers: { "X-Shopify-Access-Token": token } },
    );
    const themes = restResponse.data.themes || [];

    // Also test GraphQL access
    let gqlTest = null;
    try {
      const gqlData = await shopifyGraphQL(shop, token, `{ shop { name } }`);
      gqlTest = { success: true, shopName: gqlData?.shop?.name };
    } catch (gqlErr) {
      gqlTest = { success: false, error: gqlErr.message };
    }

    res.json({
      success: true,
      tokenPrefix: token?.slice(0, 10),
      themesCount: themes.length,
      themes: themes.map((t) => ({ id: t.id, name: t.name, role: t.role })),
      graphqlAccess: gqlTest,
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

// is that a new updated file replacing the ole rest to Gql ?
