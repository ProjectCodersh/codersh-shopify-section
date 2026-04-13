/* ─────────────────────────────────────────────────────────────────────
   All previews use a consistent light theme.
   Primary accent matches the app: #5c6bc0
   ───────────────────────────────────────────────────────────────────── */

const AC = '#5c6bc0';   // app accent (indigo)
const BL = '#3b82f6';   // blue
const GR = '#059669';   // green
const AM = '#f59e0b';   // amber / stars

/* ── Shared primitives ─────────────────────────────────────────────── */
const Stars = ({ size = 7, style = {} }) => (
  <div style={{ display: 'flex', gap: 1, ...style }}>
    {[...Array(5)].map((_, i) => (
      <span key={i} style={{ color: AM, fontSize: size, lineHeight: 1 }}>★</span>
    ))}
  </div>
);

const Line = ({ w = '100%', h = 3, color = '#e5e7eb', style = {} }) => (
  <div style={{ width: w, height: h, background: color, borderRadius: 2, flexShrink: 0, ...style }} />
);

const Dot = ({ letter = 'A', color = AC, size = 14 }) => (
  <div style={{
    width: size, height: size, borderRadius: '50%', background: color,
    color: '#fff', fontSize: size * 0.44, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    fontFamily: 'system-ui, sans-serif',
  }}>
    {letter}
  </div>
);

const MiniCard = ({ children, style = {} }) => (
  <div style={{
    background: '#fff', borderRadius: 5, padding: '7px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)', border: '1px solid #eeeff4',
    ...style,
  }}>
    {children}
  </div>
);

const Wrap = ({ children, bg = '#f7f7fb', style = {} }) => (
  <div style={{ background: bg, width: '100%', height: '100%', overflow: 'hidden', ...style }}>
    {children}
  </div>
);

const Header = ({ accentW = 40, titleW = '80%' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <Line w={accentW} h={3} color={AC} />
    <Line w={titleW} h={5} color="#1f2937" />
  </div>
);

/* ── T01: Horizontal Scroll Testimonials ───────────────────────────── */
export function PreviewT01() {
  const cards = [
    { letter: 'S', c: AC },
    { letter: 'J', c: BL },
    { letter: 'E', c: GR },
  ];
  return (
    <Wrap bg="#f5f4ff" style={{ padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <Header />
      <div style={{ display: 'flex', gap: 6, overflow: 'hidden' }}>
        {cards.map(({ letter, c }, i) => (
          <MiniCard key={i} style={{ minWidth: 78, flex: '0 0 78px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Stars />
            <Line />
            <Line w="75%" style={{ marginBottom: 4 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Dot letter={letter} color={c} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Line w={28} h={3} color="#374151" />
                <Line w={22} h={2.5} color="#9ca3af" />
              </div>
            </div>
          </MiniCard>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 3 }}>
        {[14, 5, 5, 5].map((w, i) => (
          <div key={i} style={{ width: w, height: 5, borderRadius: 3, background: i === 0 ? AC : '#d1d5db' }} />
        ))}
      </div>
    </Wrap>
  );
}

/* ── T02: Infinite Marquee ─────────────────────────────────────────── */
const Pill = ({ text }) => (
  <div style={{
    background: '#fff', borderRadius: 99, padding: '3px 9px',
    fontSize: 8, color: '#374151', fontWeight: 600,
    border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    whiteSpace: 'nowrap', flexShrink: 0,
  }}>
    {text}
  </div>
);
export function PreviewT02() {
  const r1 = ['★★★★★ Amazing', '10/10 product', 'Best purchase'];
  const r2 = ['Must have ★★★★★', 'Game changer', '5 stars always'];
  return (
    <Wrap bg="#fff" style={{ padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <Header accentW={36} titleW="75%" />
      <div style={{ background: 'linear-gradient(135deg,#f0eeff,#eef2ff)', borderRadius: 8, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 5, paddingLeft: 8 }}>
          {r1.map((t, i) => <Pill key={i} text={t} />)}
        </div>
        <div style={{ display: 'flex', gap: 5, paddingLeft: 28 }}>
          {r2.map((t, i) => <Pill key={i} text={t} />)}
        </div>
      </div>
      {/* Fade hint */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Line w="30%" h={2} color="#e5e7eb" />
        <div style={{ fontSize: 8, color: '#9ca3af', whiteSpace: 'nowrap', fontFamily: 'system-ui' }}>auto-scrolling</div>
        <Line h={2} color="#e5e7eb" />
      </div>
    </Wrap>
  );
}

/* ── T03: Video Testimonials ───────────────────────────────────────── */
export function PreviewT03() {
  const vids = [
    { letter: 'A', c: AC },
    { letter: 'R', c: BL },
    { letter: 'M', c: GR },
    { letter: 'K', c: '#f59e0b' },
  ];
  return (
    <Wrap bg="#fff" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Header accentW={38} titleW="70%" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, flex: 1 }}>
        {vids.map(({ letter, c }, i) => (
          <div key={i} style={{ borderRadius: 5, overflow: 'hidden', background: '#f3f4f6', display: 'flex', flexDirection: 'column', border: '1px solid #eeeff4' }}>
            <div style={{ flex: 1, background: `linear-gradient(135deg,${c}18,${c}10)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 17, height: 17, borderRadius: '50%', background: `${c}22`, border: `1.5px solid ${c}55`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 0, height: 0, borderStyle: 'solid', borderWidth: '4px 0 4px 7px', borderColor: `transparent transparent transparent ${c}`, marginLeft: 2 }} />
              </div>
            </div>
            <div style={{ padding: '3px 5px', display: 'flex', alignItems: 'center', gap: 3, background: '#fff' }}>
              <Dot letter={letter} color={c} size={11} />
              <Line w={26} h={3} color="#9ca3af" />
            </div>
          </div>
        ))}
      </div>
    </Wrap>
  );
}

/* ── T04: Chat Testimonials ────────────────────────────────────────── */
export function PreviewT04() {
  const msgs = [
    { side: 'left',  w: '60%', bg: '#eef2ff', lc: `${AC}88` },
    { side: 'right', w: '52%', bg: AC,         lc: 'rgba(255,255,255,0.55)' },
    { side: 'left',  w: '68%', bg: '#eef2ff',  lc: `${AC}88` },
    { side: 'right', w: '44%', bg: AC,          lc: 'rgba(255,255,255,0.55)' },
  ];
  return (
    <Wrap bg="#fafafe" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
      <Header accentW={36} titleW="70%" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, justifyContent: 'center' }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.side === 'right' ? 'flex-end' : 'flex-start' }}>
            <div style={{ background: m.bg, borderRadius: m.side === 'right' ? '10px 10px 2px 10px' : '10px 10px 10px 2px', padding: '5px 9px', width: m.w }}>
              <Line h={3} color={m.lc} style={{ marginBottom: 2 }} />
              <Line w="75%" h={3} color={m.lc} />
            </div>
          </div>
        ))}
      </div>
    </Wrap>
  );
}

/* ── T05: Center Carousel ──────────────────────────────────────────── */
export function PreviewT05() {
  return (
    <Wrap bg="#fff" style={{ padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}>
      <Header accentW={40} titleW="72%" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%' }}>
        <div style={{ width: 36, height: 56, background: '#f5f4ff', borderRadius: 5, border: '1px solid #eeeef4', opacity: 0.6, flexShrink: 0 }} />
        <MiniCard style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, boxShadow: `0 4px 16px ${AC}22`, border: `1px solid ${AC}30` }}>
          <Stars />
          <Line />
          <Line w="85%" />
          <Line w="70%" style={{ marginBottom: 4 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Dot letter="A" color={AC} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Line w={30} h={3} color="#374151" />
              <Line w={22} h={2.5} color="#9ca3af" />
            </div>
          </div>
        </MiniCard>
        <div style={{ width: 36, height: 56, background: '#f5f4ff', borderRadius: 5, border: '1px solid #eeeef4', opacity: 0.6, flexShrink: 0 }} />
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {[14, 6, 6, 6, 6].map((w, i) => (
          <div key={i} style={{ width: w, height: 6, borderRadius: 3, background: i === 0 ? AC : '#e5e7eb' }} />
        ))}
      </div>
    </Wrap>
  );
}

/* ── T06: Split Stats ──────────────────────────────────────────────── */
export function PreviewT06() {
  const stats = [
    { val: '38%', label: 'increase', color: AC },
    { val: '4.9★', label: 'avg rating', color: AM },
    { val: '50K+', label: 'customers', color: GR },
  ];
  return (
    <Wrap bg="#fff" style={{ display: 'flex' }}>
      <div style={{ flex: 1, padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderRight: '1px solid #f0f0f4', overflow: 'hidden' }}>
        <div>
          <Line w={32} h={3} color={AC} style={{ marginBottom: 4 }} />
          <Stars style={{ marginBottom: 6 }} />
          <Line style={{ marginBottom: 3 }} />
          <Line w="88%" style={{ marginBottom: 3 }} />
          <Line w="76%" style={{ marginBottom: 3 }} />
          <Line w="60%" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
          <Dot letter="J" color={AC} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Line w={28} h={3} color="#374151" />
            <Line w={22} h={2.5} color="#9ca3af" />
          </div>
        </div>
      </div>
      <div style={{ width: 78, padding: '10px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', background: '#f5f4ff' }}>
        {stats.map(({ val, label, color }, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color, lineHeight: 1.1, fontFamily: 'system-ui, sans-serif' }}>{val}</div>
            <div style={{ fontSize: 7, color: '#9ca3af', marginTop: 2, fontFamily: 'system-ui, sans-serif' }}>{label}</div>
            {i < 2 && <div style={{ height: 1, background: '#eeeef4', marginTop: 5 }} />}
          </div>
        ))}
      </div>
    </Wrap>
  );
}

/* ── T07: Before & After ───────────────────────────────────────────── */
export function PreviewT07() {
  return (
    <Wrap style={{ display: 'flex', position: 'relative' }}>
      {/* Before side */}
      <div style={{ flex: 1, background: '#f1f5f9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, position: 'relative' }}>
        <div style={{ width: 34, height: 22, background: '#cbd5e1', borderRadius: 4 }} />
        <Line w={26} h={3} color="#94a3b8" />
        <div style={{ position: 'absolute', top: 9, left: 9, background: 'rgba(17,24,39,0.55)', color: '#fff', fontSize: 7, fontWeight: 700, padding: '2px 7px', borderRadius: 99, letterSpacing: 0.5, fontFamily: 'system-ui' }}>BEFORE</div>
      </div>
      {/* After side */}
      <div style={{ flex: 1, background: '#eef2ff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, position: 'relative' }}>
        <div style={{ width: 34, height: 22, background: `${AC}28`, borderRadius: 4, border: `1px solid ${AC}40` }} />
        <Line w={26} h={3} color={`${AC}55`} />
        <div style={{ position: 'absolute', top: 9, right: 9, background: AC, color: '#fff', fontSize: 7, fontWeight: 700, padding: '2px 7px', borderRadius: 99, letterSpacing: 0.5, fontFamily: 'system-ui' }}>AFTER</div>
      </div>
      {/* Divider */}
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: '#fff', transform: 'translateX(-50%)', zIndex: 2, boxShadow: '0 0 6px rgba(0,0,0,0.12)' }} />
      {/* Handle */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <span style={{ fontSize: 7, color: '#374151', lineHeight: 1 }}>◀</span>
        <span style={{ fontSize: 7, color: '#374151', lineHeight: 1 }}>▶</span>
      </div>
    </Wrap>
  );
}

/* ── T08: Timeline ─────────────────────────────────────────────────── */
export function PreviewT08() {
  const items = [
    { year: '2019', color: AC },
    { year: '2021', color: BL },
    { year: '2024', color: GR },
  ];
  return (
    <Wrap bg="#fff" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column' }}>
      <Header accentW={36} titleW="68%" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', marginTop: 10, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 10, top: 5, bottom: 5, width: 1.5, background: '#e5e7eb', zIndex: 0 }} />
        {items.map(({ year, color }, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, position: 'relative', zIndex: 1 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, border: '2px solid #fff', boxShadow: `0 0 0 1.5px ${color}`, flexShrink: 0, marginLeft: 5.5, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, fontWeight: 700, color, marginBottom: 3, fontFamily: 'system-ui, sans-serif' }}>{year}</div>
              <Line style={{ marginBottom: 2 }} />
              <Line w="72%" />
            </div>
          </div>
        ))}
      </div>
    </Wrap>
  );
}

/* ── T09: Floating Cards ───────────────────────────────────────────── */
export function PreviewT09() {
  const cards = [
    { letter: 'S', c: AC,  left: '4%',  top: 40, rotate: -3, zIndex: 1 },
    { letter: 'J', c: BL,  left: '32%', top: 28, rotate:  2, zIndex: 3 },
    { letter: 'E', c: GR,  left: '60%', top: 36, rotate: -1, zIndex: 2 },
  ];
  return (
    <Wrap bg="linear-gradient(135deg,#f5f4ff,#eef2ff)" style={{ position: 'relative', padding: 10 }}>
      <div style={{ position: 'relative', zIndex: 5 }}>
        <Header accentW={36} titleW="64%" />
      </div>
      {cards.map(({ letter, c, left, top, rotate, zIndex }, i) => (
        <div key={i} style={{ position: 'absolute', left, top, width: '30%', transform: `rotate(${rotate}deg)`, zIndex }}>
          <MiniCard style={{ padding: '6px', boxShadow: '0 4px 14px rgba(0,0,0,0.09)' }}>
            <Stars size={6} style={{ marginBottom: 4 }} />
            <Line style={{ marginBottom: 2 }} />
            <Line w="80%" style={{ marginBottom: 5 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Dot letter={letter} color={c} size={12} />
              <Line w={24} h={3} color="#374151" />
            </div>
          </MiniCard>
        </div>
      ))}
    </Wrap>
  );
}

/* ── T10: Masonry Grid ─────────────────────────────────────────────── */
function MasonryCol({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
      {items.map(({ h, letter, c, lines }, i) => (
        <MiniCard key={i} style={{ height: h, display: 'flex', flexDirection: 'column', gap: 3, padding: '6px', overflow: 'hidden' }}>
          <Stars size={6} />
          {[...Array(lines)].map((_, j) => (
            <Line key={j} w={j === lines - 1 ? '70%' : '100%'} />
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Dot letter={letter} color={c} size={11} />
            <Line w={24} h={3} color="#374151" />
          </div>
        </MiniCard>
      ))}
    </div>
  );
}
export function PreviewT10() {
  return (
    <Wrap bg="#f7f7fb" style={{ padding: 10, display: 'flex', flexDirection: 'column' }}>
      <Header accentW={36} titleW="63%" />
      <div style={{ display: 'flex', gap: 5, flex: 1, overflow: 'hidden', alignItems: 'flex-start', marginTop: 8 }}>
        <MasonryCol items={[
          { h: 50, letter: 'S', c: AC, lines: 3 },
          { h: 34, letter: 'J', c: BL, lines: 1 },
        ]} />
        <MasonryCol items={[
          { h: 32, letter: 'E', c: GR,  lines: 1 },
          { h: 52, letter: 'M', c: AM, lines: 3 },
        ]} />
      </div>
    </Wrap>
  );
}

/* ── Preview map ───────────────────────────────────────────────────── */
export const SECTION_PREVIEWS = {
  'cws-t01-horizontal-scroll':  PreviewT01,
  'cws-t02-infinite-marquee':   PreviewT02,
  'cws-t03-video-testimonials': PreviewT03,
  'cws-t04-chat-testimonials':  PreviewT04,
  'cws-t05-center-carousel':    PreviewT05,
  'cws-t06-split-stats':        PreviewT06,
  'cws-t07-before-after':       PreviewT07,
  'cws-t08-timeline':           PreviewT08,
  'cws-t09-floating-cards':     PreviewT09,
  'cws-t10-masonry-grid':       PreviewT10,
};
