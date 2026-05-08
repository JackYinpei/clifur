// Decorative climbing-wall preview shown next to the hero copy.
// Matches the in-game look: textured kraft-paper wall with irregular,
// hand-shaped holds in real climbing-gym colors (green, blue, purple,
// yellow, orange, red, etc.) plus a single highlighted route.

const VIEW_W = 360;
const VIEW_H = 480;

// Each hold lives on the wall at world coords (x, y) with a deterministic
// shape and a real-gym color. The "highlighted route" is a single color
// (purple) — that's how routes are set in real gyms; the start/finish are
// marked with colored tape stripes above the hold instead.
const HOLDS = [
  // Highlighted route — all purple, with tape stripes on start & finish
  { x: 178, y: 432, r: 26, color: "purple", shape: "jug", route: "start" },
  { x: 122, y: 372, r: 22, color: "purple", shape: "jug", route: true },
  { x: 232, y: 348, r: 18, color: "purple", shape: "crimp", route: true },
  { x: 158, y: 282, r: 24, color: "purple", shape: "sloper", route: true },
  { x: 244, y: 226, r: 20, color: "purple", shape: "jug", route: true },
  { x: 132, y: 178, r: 20, color: "purple", shape: "crimp", route: true },
  { x: 220, y: 132, r: 22, color: "purple", shape: "jug", route: true },
  { x: 178, y: 60, r: 28, color: "purple", shape: "jug", route: "finish" },

  // Background holds (other routes — varied colors)
  { x: 56, y: 432, r: 18, color: "yellow", shape: "jug" },
  { x: 296, y: 412, r: 20, color: "blue", shape: "jug" },
  { x: 76, y: 318, r: 16, color: "orange", shape: "crimp" },
  { x: 308, y: 290, r: 22, color: "green", shape: "sloper" },
  { x: 60, y: 240, r: 18, color: "red", shape: "jug" },
  { x: 296, y: 168, r: 16, color: "pink", shape: "crimp" },
  { x: 60, y: 120, r: 22, color: "blue", shape: "sloper" },
  { x: 304, y: 92, r: 18, color: "yellow", shape: "jug" },
  { x: 90, y: 56, r: 16, color: "orange", shape: "crimp" },
];

// Real gym hold colors come in matched base + dark pairs
const COLORS = {
  green: ["#3fb958", "#1f7a35"],
  red: ["#e3543f", "#9f2818"],
  blue: ["#3a7fd6", "#1c4a86"],
  yellow: ["#f0c63a", "#a98517"],
  orange: ["#ec934a", "#9c5520"],
  purple: ["#9356d3", "#54287a"],
  pink: ["#e36ba8", "#a52e6a"],
};

// Deterministic blob points — simple PRNG keyed on the hold index so the
// shapes look "carved" but stay stable across renders.
function blob(cx, cy, r, seed, points = 11, jitter = 0.55) {
  const out = [];
  let h = seed * 2654435761;
  for (let i = 0; i < points; i++) {
    h = (h ^ (h << 13)) >>> 0;
    h = (h ^ (h >>> 17)) >>> 0;
    h = (h ^ (h << 5)) >>> 0;
    const wobble = 1 - jitter / 2 + ((h % 1000) / 1000) * jitter;
    const a = (i / points) * Math.PI * 2;
    const rr = r * wobble;
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85]);
  }
  return out;
}

function pathFromPoints(pts) {
  return (
    "M" + pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" L ") + " Z"
  );
}

function HoldShape({ hold, idx }) {
  const [base, dark] = COLORS[hold.color] || COLORS.purple;
  const { x, y, r, shape } = hold;

  if (shape === "crimp") {
    // small horizontal pill
    const w = r * 1.7;
    const h = r * 0.55;
    const rx = h / 2;
    return (
      <g>
        <rect
          x={x - w / 2 + 1.5}
          y={y - h / 2 + 2}
          width={w}
          height={h}
          rx={rx}
          fill="rgba(0,0,0,0.28)"
        />
        <rect
          x={x - w / 2}
          y={y - h / 2}
          width={w}
          height={h}
          rx={rx}
          fill={base}
          stroke="rgba(0,0,0,0.45)"
          strokeWidth="1"
        />
        <rect
          x={x - w / 2}
          y={y - h * 0.05}
          width={w}
          height={h * 0.3}
          rx={rx * 0.6}
          fill={dark}
          opacity="0.85"
        />
      </g>
    );
  }

  if (shape === "sloper") {
    return (
      <g>
        <ellipse
          cx={x + 1.5}
          cy={y + 2.5}
          rx={r}
          ry={r * 0.85}
          fill="rgba(0,0,0,0.28)"
        />
        <defs>
          <radialGradient id={`g-${idx}`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#fbe9c8" stopOpacity="0.85" />
            <stop offset="55%" stopColor={base} />
            <stop offset="100%" stopColor={dark} />
          </radialGradient>
        </defs>
        <ellipse
          cx={x}
          cy={y}
          rx={r}
          ry={r * 0.85}
          fill={`url(#g-${idx})`}
          stroke="rgba(0,0,0,0.4)"
          strokeWidth="1"
        />
      </g>
    );
  }

  // jug — irregular blob
  const pts = blob(x, y, r, idx + 1);
  const d = pathFromPoints(pts);
  const shadow = pathFromPoints(blob(x + 1.5, y + 3, r, idx + 1));
  const shadeId = `shade-${idx}`;
  return (
    <g>
      <path d={shadow} fill="rgba(0,0,0,0.28)" />
      <defs>
        <linearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="55%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor={dark} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path d={d} fill={base} stroke="rgba(0,0,0,0.42)" strokeWidth="1.1" />
      <path d={d} fill={`url(#${shadeId})`} />
      <circle
        cx={x + r * 0.05}
        cy={y - r * 0.05}
        r={Math.max(1.5, r * 0.08)}
        fill="rgba(0,0,0,0.55)"
      />
    </g>
  );
}

function RouteTape({ hold }) {
  // Colored marker tape stripes above start/finish
  if (!hold.route || hold.route === true) return null;
  const stripes =
    hold.route === "start"
      ? ["#22c55e", "#3b82f6", "#a855f7", "#facc15"]
      : ["#ef4444", "#f59e0b", "#a855f7", "#22c55e"];
  return (
    <g transform={`translate(${hold.x}, ${hold.y - hold.r - 4})`}>
      {stripes.map((c, i) => (
        <rect
          key={i}
          x={(i - (stripes.length - 1) / 2) * 4 - 1.5}
          y={-10 - i * 2}
          width="3"
          height="12"
          fill={c}
        />
      ))}
    </g>
  );
}

export default function HeroWallPreview() {
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-3xl border border-stone-300 shadow-xl">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="wall-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f3dcb1" />
            <stop offset="60%" stopColor="#e8cf9b" />
            <stop offset="100%" stopColor="#d3b07c" />
          </linearGradient>
          <pattern
            id="wall-tex"
            width="48"
            height="48"
            patternUnits="userSpaceOnUse"
          >
            <rect width="48" height="48" fill="rgba(255,255,255,0)" />
            <circle cx="6" cy="10" r="0.6" fill="rgba(0,0,0,0.06)" />
            <circle cx="22" cy="32" r="0.5" fill="rgba(0,0,0,0.05)" />
            <circle cx="36" cy="6" r="0.4" fill="rgba(0,0,0,0.06)" />
            <circle cx="40" cy="40" r="0.5" fill="rgba(0,0,0,0.05)" />
          </pattern>
        </defs>

        {/* wall surface */}
        <rect width={VIEW_W} height={VIEW_H} fill="url(#wall-bg)" />
        <rect width={VIEW_W} height={VIEW_H} fill="url(#wall-tex)" />

        {/* faint vertical panel seams */}
        {[120, 240].map((x) => (
          <line
            key={x}
            x1={x}
            y1="0"
            x2={x}
            y2={VIEW_H}
            stroke="rgba(0,0,0,0.06)"
            strokeWidth="1"
          />
        ))}

        {/* highlighted route — dotted path connecting purple holds */}
        <g opacity="0.32">
          <path
            d={(() => {
              const route = HOLDS.filter((h) => h.color === "purple");
              return route
                .map((h, i) => `${i === 0 ? "M" : "L"}${h.x},${h.y}`)
                .join(" ");
            })()}
            fill="none"
            stroke="#7c3aed"
            strokeWidth="2"
            strokeDasharray="4 6"
            strokeLinecap="round"
          />
        </g>

        {/* holds */}
        {HOLDS.map((h, i) => (
          <HoldShape key={i} hold={h} idx={i} />
        ))}

        {/* route tape on start/finish */}
        {HOLDS.map((h, i) => (
          <RouteTape key={`t-${i}`} hold={h} />
        ))}
      </svg>

      <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-stone-700 shadow-sm backdrop-blur">
        紫色路线 · 8 个手点
      </div>
    </div>
  );
}
