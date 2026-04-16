import { useState, useEffect } from "react";
import axios from "axios";
import "./App.css";
import { SECTION_PREVIEWS } from "./SectionPreviews";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

// Read the ?shop= param from the URL.
// Shopify passes this automatically when loading an embedded app.
// For local dev, open the frontend at: http://localhost:5173?shop=your-store.myshopify.com
const SHOP = new URLSearchParams(window.location.search).get("shop") || "";

const CATEGORY_COLORS = {
  Testimonials: "linear-gradient(135deg, #667eea, #764ba2)",
  Media: "linear-gradient(135deg, #f093fb, #f5576c)",
  Content: "linear-gradient(135deg, #4facfe, #00f2fe)",
  default: "linear-gradient(135deg, #43e97b, #38f9d7)",
};

/* ── Icons ─────────────────────────────────────────────────────────── */
const IconPlus = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconCheck = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconTrash = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);
const IconSearch = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconX = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconAlert = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);
const IconSuccess = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconGridOff = () => (
  <svg
    width="40"
    height="40"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);
const IconExternalLink = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

/* ── Section Card ───────────────────────────────────────────────────── */
function SectionCard({
  section,
  onInstall,
  onRemove,
  installing,
  removing,
  installed,
  themeEditorUrl,
}) {
  const isInstalling = installing === section.id;
  const isRemoving = removing === section.id;
  const isInstalled = installed.includes(section.id);
  const bgColor = CATEGORY_COLORS[section.category] || CATEGORY_COLORS.default;
  const PreviewComponent = SECTION_PREVIEWS[section.id];

  return (
    <div className={`section-card${isInstalled ? " is-installed" : ""}`}>
      <div
        className={`section-preview${PreviewComponent ? " has-preview" : ""}`}
        style={PreviewComponent ? {} : { background: bgColor }}
      >
        {PreviewComponent ? (
          <PreviewComponent />
        ) : (
          <span className="section-preview-letter">{section.name[0]}</span>
        )}
        <span className="section-category-badge">{section.category}</span>
        {isInstalled && (
          <span className="installed-badge">
            <IconCheck /> Installed
          </span>
        )}
      </div>
      <div className="section-info">
        <h3>{section.name}</h3>
        <p>{section.description}</p>
        <div className="card-actions">
          {isInstalled ? (
            <>
              <a
                href={themeEditorUrl}
                target="_blank"
                rel="noreferrer"
                className="editor-btn"
              >
                <IconExternalLink /> Open Theme Editor
              </a>
              <button
                onClick={() => onRemove(section)}
                disabled={isRemoving}
                className={`remove-btn-icon${isRemoving ? " loading" : ""}`}
                title="Remove from theme"
                aria-label="Remove from theme"
              >
                {isRemoving ? (
                  <span className="spinner spinner-dark" />
                ) : (
                  <IconTrash />
                )}
              </button>
            </>
          ) : (
            <button
              onClick={() => !isInstalled && onInstall(section)}
              disabled={isInstalling}
              className={`install-btn${isInstalling ? " loading" : ""}`}
            >
              {isInstalling ? (
                <>
                  <span className="spinner" /> Installing…
                </>
              ) : (
                <>
                  <IconPlus /> Add to Theme
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Skeleton ───────────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-preview" />
      <div className="skeleton-body">
        <div className="skel skel-title" />
        <div className="skel skel-line" />
        <div className="skel skel-line short" />
        <div className="skel skel-btn" />
      </div>
    </div>
  );
}

/* ── App ────────────────────────────────────────────────────────────── */
export default function App() {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [installed, setInstalled] = useState([]);
  const [message, setMessage] = useState(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [themeEditorUrl, setThemeEditorUrl] = useState("#");

  useEffect(() => {
    // If no shop in URL, nothing to load
    if (!SHOP) {
      setMessage({ type: "error", text: "No shop parameter in URL." });
      setLoading(false);
      return;
    }

    // Fetch sections and shop info in parallel
    Promise.all([
      axios.get(`${BACKEND_URL}/sections?shop=${SHOP}`),
      axios.get(`${BACKEND_URL}/store-info?shop=${SHOP}`),
    ])
      .then(([sectionsRes, storeRes]) => {
        setSections(sectionsRes.data);
        const alreadyInstalled = sectionsRes.data
          .filter((s) => s.installed)
          .map((s) => s.id);
        setInstalled(alreadyInstalled);
        const shop = storeRes.data.shop;
        setThemeEditorUrl(`https://${shop}/admin/themes/current/editor`);
        setLoading(false);
      })
      .catch((err) => {
        // 401 means the app isn't installed on this store yet —
        // redirect to the OAuth install flow so Shopify can authorize it.
        if (err.response?.status === 401 && err.response?.data?.authUrl) {
          window.location.href = err.response.data.authUrl;
          return;
        }
        setMessage({
          type: "error",
          text: "Could not load sections. Is the backend running?",
        });
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  const handleInstall = async (section) => {
    setInstalling(section.id);
    setMessage(null);
    try {
      await axios.post(`${BACKEND_URL}/inject-section`, {
        sectionId: section.id,
        shop: SHOP,
      });
      setInstalled((prev) => [...prev, section.id]);
      setMessage({
        type: "success",
        text: `"${section.name}" added! Go to Theme Editor → Add section to place it on your page.`,
        link: themeEditorUrl,
        linkText: "Open Theme Editor →",
      });
    } catch (err) {
      const shopifyMsg = err.response?.data?.shopifyError?.errors
        || err.response?.data?.shopifyError?.error
        || err.response?.data?.error
        || err.message;
      setMessage({
        type: "error",
        text: `Failed to add "${section.name}": ${typeof shopifyMsg === "object" ? JSON.stringify(shopifyMsg) : shopifyMsg}`,
      });
    }
    setInstalling(null);
  };

  const handleRemove = async (section) => {
    setRemoving(section.id);
    setMessage(null);
    try {
      await axios.delete(`${BACKEND_URL}/remove-section`, {
        data: { sectionId: section.id, shop: SHOP },
      });
      setInstalled((prev) => prev.filter((id) => id !== section.id));
      setMessage({
        type: "success",
        text: `"${section.name}" removed from your theme.`,
      });
    } catch (err) {
      const detail = err.response?.data?.error || err.message;
      setMessage({
        type: "error",
        text: `Failed to remove "${section.name}": ${detail}`,
      });
    }
    setRemoving(null);
  };

  const categories = ["All", ...new Set(sections.map((s) => s.category))];

  const filtered = sections.filter((s) => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory =
      activeCategory === "All" || s.category === activeCategory;
    return matchSearch && matchCategory;
  });

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="brand-mark">
              <svg viewBox="0 0 36 36" fill="none">
                <rect
                  width="36"
                  height="36"
                  rx="9"
                  fill="white"
                  fillOpacity="0.1"
                />
                <path
                  d="M10 12h16M10 18h11M10 24h13"
                  stroke="white"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <h1>Codersh Sections</h1>
              <p>Premium Shopify sections — click to add to your theme</p>
            </div>
          </div>
          <div className="header-stats">
            <span>
              <strong>{sections.length}</strong> Sections
            </span>
            <span>
              <strong>{installed.length}</strong> Installed
            </span>
          </div>
        </div>
      </header>

      {/* ── Message ── */}
      {message && (
        <div
          className={`message ${message.type}`}
          onClick={() => setMessage(null)}
        >
          <span className="message-icon">
            {message.type === "success" ? <IconSuccess /> : <IconAlert />}
          </span>
          <span className="message-text">
            {message.text}
            {message.link && (
              <a
                href={message.link}
                target="_blank"
                rel="noreferrer"
                className="message-link"
              >
                {message.linkText}
              </a>
            )}
          </span>
          <button className="message-dismiss" aria-label="Dismiss">
            <IconX size={13} />
          </button>
        </div>
      )}

      {/* ── Controls ── */}
      <div className="controls">
        <div className="search-wrap">
          <span className="search-icon-wrap">
            <IconSearch />
          </span>
          <input
            type="text"
            placeholder="Search sections..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          {search && (
            <button
              className="search-clear"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <IconX size={13} />
            </button>
          )}
        </div>
        <div className="category-tabs">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`category-tab${activeCategory === cat ? " active" : ""}`}
            >
              {cat}
              <span className="tab-pill">
                {cat === "All"
                  ? sections.length
                  : sections.filter((s) => s.category === cat).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <div className="sections-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="sections-grid">
          {filtered.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              onInstall={handleInstall}
              onRemove={handleRemove}
              installing={installing}
              removing={removing}
              installed={installed}
              themeEditorUrl={themeEditorUrl}
            />
          ))}
          {filtered.length === 0 && (
            <div className="no-results">
              <IconGridOff />
              <p>
                No sections found for <strong>"{search}"</strong>
              </p>
              <button
                className="no-results-reset"
                onClick={() => {
                  setSearch("");
                  setActiveCategory("All");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
