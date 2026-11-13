// Crew marks: animated pirate icons that give the desk its One Piece flavour.
// The gold props are game-icons.net (CC BY 3.0) through react-icons, filled gold
// with a dark edge so they stand out on both themes; the five crew emblems are
// drawn here in full colour, each led by its trader's own hue. Each mark moves in its own way (a chest that bobs,
// a ship's wheel that turns, an anchor that swings); everything stops under
// prefers-reduced-motion. Marks are decoration only: aria-hidden, no meaning
// that the text around them does not already carry.

import type { CSSProperties, ReactNode } from "react";
import {
  GiAnchor,
  GiBigWave,
  GiLightningStorm,
  GiSun,
  GiWaves,
  GiOpenTreasureChest,
  GiPirateFlag,
  GiSailboat,
  GiSinkingShip,
  GiSpyglass,
  GiTreasureMap,
  GiTwoCoins,
  GiCrossedSwords,
  GiChefToque,
} from "react-icons/gi";

/** How a mark moves. Each is a CSS keyframe set in styles.css (.crew[data-motion]). */
export type Motion = "bob" | "spin" | "swing" | "rock" | "bounce" | "wave" | "flip" | "sink" | "slice";

/** A plain straw hat with a red band, in the game-icons 512 grid. */
export function StrawHat(props: { size?: number | string }) {
  const s = props.size ?? "1em";
  return (
    <svg viewBox="0 0 512 512" width={s} height={s} aria-hidden="true">
      <ellipse cx="256" cy="330" rx="236" ry="78" fill="#e9c46a" stroke="#8a6a1f" strokeWidth="14" />
      <path d="M128 318 C128 170 384 170 384 318 Z" fill="#f2d27a" stroke="#8a6a1f" strokeWidth="14" />
      <path d="M131 286 C170 262 342 262 381 286 L384 318 C342 296 170 296 128 318 Z" fill="#d62828" />
      <path d="M180 360 l20 14 M240 372 l14 12 M320 366 l18 12 M110 340 l18 10 M390 344 l18 8" stroke="#b08a2e" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

const EDGE = "#2a1d10";
const GOLD = "#ffc83d";

/** Robin: an open book with a gold ribbon. */
function Book() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M3 17 Q18 10 32 17 Q46 10 61 17 L61 54 Q46 47 32 54 Q18 47 3 54 Z" fill="var(--t-robin)" stroke={EDGE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M7 14 Q20 8 31 14 L31 49 Q20 43 7 49 Z" fill="#fffaf0" stroke={EDGE} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M33 14 Q44 8 57 14 L57 49 Q44 43 33 49 Z" fill="#fffaf0" stroke={EDGE} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M11 22 Q19 19 27 22 M11 29 Q19 26 27 29 M11 36 Q19 33 27 36 M37 29 Q45 26 53 29 M37 36 Q45 33 53 36" stroke="#a89f91" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M42 11 L42 27 L45.5 23.5 L49 27 L49 10.5" fill={GOLD} stroke={EDGE} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Nami: a gold compass with her colour on the north needle. */
function Compass() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill={GOLD} stroke={EDGE} strokeWidth="2" />
      <circle cx="32" cy="32" r="21" fill="#fff8e7" stroke={EDGE} strokeWidth="1.4" />
      <path d="M32 13 V17 M32 47 V51 M13 32 H17 M47 32 H51" stroke={EDGE} strokeWidth="2" strokeLinecap="round" />
      <path d="M32 12 L38 32 L26 32 Z" fill="var(--t-nami)" stroke={EDGE} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M32 52 L38 32 L26 32 Z" fill="#2b4a8b" stroke={EDGE} strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="32" cy="32" r="3.2" fill={GOLD} stroke={EDGE} strokeWidth="1.4" />
    </svg>
  );
}

/** Jinbe: a wooden ship's wheel with gold handles and a hub in his colour. */
function Wheel() {
  const spokes = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      {spokes.map((a) => (
        <line key={a} x1="32" y1="32" x2={32 + 28 * Math.cos(a)} y2={32 + 28 * Math.sin(a)} stroke="#8b5a2b" strokeWidth="5" strokeLinecap="round" />
      ))}
      {spokes.map((a) => (
        <circle key={a} cx={32 + 27 * Math.cos(a)} cy={32 + 27 * Math.sin(a)} r="3.6" fill={GOLD} stroke={EDGE} strokeWidth="1.2" />
      ))}
      <circle cx="32" cy="32" r="18" fill="none" stroke={EDGE} strokeWidth="8.5" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#b5773a" strokeWidth="5.5" />
      <circle cx="32" cy="32" r="8" fill="var(--t-jinbe)" stroke={EDGE} strokeWidth="2" />
      <circle cx="32" cy="32" r="2.8" fill={GOLD} />
    </svg>
  );
}

/** Law: a scalpel with a handle in his colour, and a red heart. */
function Scalpel() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g transform="rotate(-40 32 34)">
        <rect x="4" y="30" width="32" height="9" rx="3.5" fill="var(--t-law)" stroke={EDGE} strokeWidth="2" />
        <path d="M11 32.5 V36.5 M16 32.5 V36.5 M21 32.5 V36.5" stroke={EDGE} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M36 31 L50 31 Q62 33 59 37 L36 38 Z" fill="#e3e9f0" stroke="#3c4752" strokeWidth="2" strokeLinejoin="round" />
        <path d="M38 34 L54 34" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <path d="M49 9 C46 4 38 6 38 12 C38 18 49 24 49 24 C49 24 60 18 60 12 C60 6 52 4 49 9 Z" fill="#e63946" stroke={EDGE} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

const TRADER: Record<string, { icon: ReactNode; motion: Motion; title: string }> = {
  // Robin reads the old texts: here, the regime and the signals that paid in it.
  robin: { icon: <Book />, motion: "flip", title: "the archaeologist" },
  // Nami navigates the weather: a portfolio for every season.
  nami: { icon: <Compass />, motion: "swing", title: "the navigator" },
  // Jinbe follows the deterministic momentum rules.
  jinbe: { icon: <Wheel />, motion: "spin", title: "the helmsman" },
  // Law follows the deterministic dip-and-rebound rules.
  law: { icon: <Scalpel />, motion: "slice", title: "the surgeon" },
  // Luffy bounces in and out the same day.
  luffy: { icon: <StrawHat />, motion: "bounce", title: "the captain" },
  zoro: { icon: <GiCrossedSwords />, motion: "slice", title: "the value swordsman" },
  sanji: { icon: <GiChefToque />, motion: "bob", title: "the macro cook" },
};

export const ICONS = {
  chest: <GiOpenTreasureChest />,
  spyglass: <GiSpyglass />,
  map: <GiTreasureMap />,
  anchor: <GiAnchor />,
  sail: <GiSailboat />,
  sinking: <GiSinkingShip />,
  coins: <GiTwoCoins />,
  flag: <GiPirateFlag />,
} as const;

/** The sea for each market regime, for the Market Year story. */
const SEA: Record<string, { icon: ReactNode; motion: Motion }> = {
  "Calm bull": { icon: <GiSun />, motion: "spin" },
  "Volatile bull": { icon: <GiBigWave />, motion: "rock" },
  "Calm chop": { icon: <GiWaves />, motion: "wave" },
  Stress: { icon: <GiLightningStorm />, motion: "swing" },
};

export function RegimeMark(props: { label: string; corner?: boolean; play?: "always" | "hover" | "active" }) {
  const sea = SEA[props.label] ?? { icon: <GiSpyglass />, motion: "rock" as Motion };
  return <Crew icon={sea.icon} motion={sea.motion} corner={props.corner} play={props.play} />;
}

/**
 * One animated mark. `corner` pins it to the upper right of the nearest
 * positioned card; `play` = "hover" only moves it while the card is hovered or
 * focused, "always" keeps a slow loop, "active" moves it inside a current story step.
 */
export function Crew(props: {
  icon: ReactNode;
  motion: Motion;
  color?: string;
  size?: number;
  corner?: boolean;
  play?: "always" | "hover" | "active";
  delay?: number;
}) {
  const style = {
    color: props.color,
    fontSize: props.size ?? 34,
    animationDelay: props.delay ? `${props.delay}ms` : undefined,
  } as CSSProperties;
  return (
    <span
      className={props.corner ? "crew crew-corner" : "crew"}
      data-motion={props.motion}
      data-play={props.play ?? "always"}
      data-tone={props.color ? undefined : "gold"}
      style={style}
      aria-hidden="true"
    >
      {props.icon}
    </span>
  );
}

/** A trader's own mark, in the trader's colour. */
export function TraderMark(props: { name: string; size?: number; corner?: boolean; play?: "always" | "hover" | "active" }) {
  const t = TRADER[props.name.toLowerCase()];
  if (!t) return null;
  return (
    <Crew
      icon={t.icon}
      motion={t.motion}
      color="inherit"
      size={props.size}
      corner={props.corner}
      play={props.play ?? "hover"}
    />
  );
}

/** The crew role, for a title attribute: "Luffy, the captain". */
export function crewRole(name: string): string {
  return TRADER[name.toLowerCase()]?.title ?? "";
}
