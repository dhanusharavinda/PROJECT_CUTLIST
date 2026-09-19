/**
 * Line art for the empty states that matter most.
 *
 * Drawn from the same primitives the product uses (a filmstrip, a marker
 * track, a waveform), so an empty screen still says what the screen is for.
 * Hairlines and one accent only; anything busier would fight the glass.
 */

const STROKE = "rgba(255,255,255,0.16)";
const ACCENT = "var(--color-signal)";

export function FilmstripArt() {
  return (
    <svg
      width="132"
      height="74"
      viewBox="0 0 132 74"
      fill="none"
      aria-hidden
      className="overflow-visible"
    >
      <rect
        x="6.5"
        y="14.5"
        width="119"
        height="45"
        rx="6"
        stroke={STROKE}
        strokeWidth="1"
      />
      {/* sprocket holes */}
      {[16, 30, 44, 58, 72, 86, 100, 114].map((x) => (
        <g key={x}>
          <rect x={x} y="19" width="6" height="4" rx="1.2" fill={STROKE} />
          <rect x={x} y="51" width="6" height="4" rx="1.2" fill={STROKE} />
        </g>
      ))}
      <line
        x1="6.5"
        y1="28.5"
        x2="125.5"
        y2="28.5"
        stroke={STROKE}
        strokeWidth="1"
      />
      <line
        x1="6.5"
        y1="45.5"
        x2="125.5"
        y2="45.5"
        stroke={STROKE}
        strokeWidth="1"
      />
      {/* one lit frame: the thing that is missing */}
      <rect
        x="52"
        y="29"
        width="28"
        height="16"
        fill={ACCENT}
        opacity="0.14"
      />
      <line
        x1="66"
        y1="4"
        x2="66"
        y2="70"
        stroke={ACCENT}
        strokeWidth="1.25"
        opacity="0.55"
      />
      <circle cx="66" cy="4" r="2.5" fill={ACCENT} opacity="0.8" />
    </svg>
  );
}

export function MarkerTrackArt() {
  const marks: [number, string][] = [
    [26, "#ff6b57"],
    [48, "#8aa2ff"],
    [70, "#5fd3b0"],
    [96, "#ffd166"],
  ];
  return (
    <svg width="132" height="62" viewBox="0 0 132 62" fill="none" aria-hidden>
      <rect
        x="6.5"
        y="16.5"
        width="119"
        height="30"
        rx="6"
        stroke={STROKE}
        strokeWidth="1"
      />
      {/* waveform bed */}
      {Array.from({ length: 40 }).map((_, i) => {
        const h = 4 + Math.abs(Math.sin(i * 0.8)) * 13;
        return (
          <rect
            key={i}
            x={11 + i * 2.8}
            y={31.5 - h / 2}
            width="1.2"
            height={h}
            rx="0.6"
            fill="rgba(255,255,255,0.10)"
          />
        );
      })}
      {marks.map(([x, color]) => (
        <rect
          key={x}
          x={x}
          y="17"
          width="2"
          height="29"
          rx="1"
          fill={color}
          opacity="0.55"
        />
      ))}
      <line
        x1="18"
        y1="10"
        x2="18"
        y2="52"
        stroke={ACCENT}
        strokeWidth="1.25"
      />
      <circle cx="18" cy="10" r="2.5" fill={ACCENT} />
    </svg>
  );
}

export function MicArt() {
  return (
    <svg width="120" height="72" viewBox="0 0 120 72" fill="none" aria-hidden>
      {/* speech, becoming structure */}
      <rect
        x="6.5"
        y="12.5"
        width="46"
        height="30"
        rx="8"
        stroke={STROKE}
        strokeWidth="1"
      />
      <path d="M18 42.5 L18 51 L27 42.5" stroke={STROKE} strokeWidth="1" fill="none" />
      {[
        [15, 22, 28],
        [15, 28, 20],
        [15, 34, 25],
      ].map(([x, y, w]) => (
        <rect
          key={y}
          x={x}
          y={y}
          width={w}
          height="2.5"
          rx="1.25"
          fill="rgba(255,255,255,0.14)"
        />
      ))}
      <path
        d="M60 27.5 L74 27.5"
        stroke={ACCENT}
        strokeWidth="1.25"
        opacity="0.6"
      />
      <path
        d="M70 23.5 L74.5 27.5 L70 31.5"
        stroke={ACCENT}
        strokeWidth="1.25"
        fill="none"
        opacity="0.6"
      />
      {[14, 26, 38].map((y, i) => (
        <g key={y}>
          <rect
            x="82"
            y={y}
            width="31"
            height="12"
            rx="4"
            stroke={STROKE}
            strokeWidth="1"
          />
          <circle
            cx="88"
            cy={y + 6}
            r="2"
            fill={["#ff6b57", "#8aa2ff", "#ffd166"][i]}
            opacity="0.7"
          />
          <rect
            x="94"
            y={y + 5}
            width="13"
            height="2"
            rx="1"
            fill="rgba(255,255,255,0.14)"
          />
        </g>
      ))}
    </svg>
  );
}
