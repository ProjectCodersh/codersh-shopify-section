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

const SHOP = process.env.SHOP;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

app.get("/", (req, res) => {
  res.json({ message: "Codersh Sections backend is running!" });
});

// Returns the shop domain so the frontend can build theme editor links
app.get("/store-info", (_req, res) => {
  res.json({ shop: SHOP });
});

// Get all sections + installed state
app.get("/sections", async (req, res) => {
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

// Inject a section into active theme
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

    // Inject asset files (CSS, JS) if any  ← THIS is where it belongs
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
    res.status(500).json({
      error: error.message,
      details: error.response?.data,
    });
  }
});

// Remove a section
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
