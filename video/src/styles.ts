export const COLORS = {
  black: '#000000',
  darkBg: '#0a0a0a',
  terminalGreen: '#00ff41',
  terminalDim: '#00aa2a',
  white: '#ffffff',
  gold: '#FFD700',
  goldDark: '#B8860B',
  accent: '#00e5ff',
  dimWhite: 'rgba(255,255,255,0.7)',
  cardBg: 'rgba(0,0,0,0.75)',
  cardBorder: 'rgba(0,229,255,0.4)',
  glitch: '#ff0040',
} as const;

export const FONTS = {
  mono: "'Courier New', 'Consolas', monospace",
  display: "'Arial Black', 'Impact', sans-serif",
  body: "'Arial', 'Helvetica Neue', sans-serif",
} as const;

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 900,
} as const;

// Scene timing (in frames at 30fps)
export const SCENES = {
  boot: { start: 0, duration: 120 },         // 0-4s
  agentsOnline: { start: 120, duration: 180 }, // 4-10s
  simulation: { start: 300, duration: 240 },   // 10-18s
  aiTakeover: { start: 540, duration: 120 },   // 18-22s
  tokenClose: { start: 660, duration: 240 },   // 22-30s
} as const;
