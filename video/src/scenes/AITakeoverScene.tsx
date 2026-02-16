import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
} from 'remotion';
import { COLORS, FONTS } from '../styles';

const STATEMENTS = [
  { text: 'no humans.', startFrame: 10 },
  { text: 'no scripts.', startFrame: 40 },
  { text: 'autonomous agents.', startFrame: 70 },
];

export const AITakeoverScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Subtle bg pulse
  const bgBrightness = interpolate(
    Math.sin(frame * 0.08),
    [-1, 1],
    [0.02, 0.06]
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: `rgb(${Math.floor(bgBrightness * 255)}, ${Math.floor(bgBrightness * 100)}, ${Math.floor(bgBrightness * 150)})`,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Grid lines bg */}
      <AbsoluteFill
        style={{
          background: `
            linear-gradient(rgba(0,229,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,229,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          opacity: interpolate(frame, [0, 20], [0, 1], {
            extrapolateRight: 'clamp',
          }),
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 30,
        }}
      >
        {STATEMENTS.map((stmt, i) => {
          const elapsed = frame - stmt.startFrame;
          if (elapsed < 0) return null;

          const scale = spring({
            frame: elapsed,
            fps: 30,
            config: { damping: 8, stiffness: 200, mass: 0.5 },
          });

          const opacity = interpolate(elapsed, [0, 3], [0, 1], {
            extrapolateRight: 'clamp',
          });

          const isLast = i === STATEMENTS.length - 1;

          return (
            <div
              key={i}
              style={{
                fontFamily: FONTS.display,
                fontSize: isLast ? 90 : 80,
                fontWeight: 900,
                color: isLast ? COLORS.accent : COLORS.white,
                textTransform: 'uppercase',
                letterSpacing: isLast ? 8 : 4,
                transform: `scale(${scale})`,
                opacity,
                textShadow: isLast
                  ? `0 0 30px ${COLORS.accent}, 0 0 60px ${COLORS.accent}40`
                  : '0 0 20px rgba(255,255,255,0.3)',
              }}
            >
              {stmt.text}
            </div>
          );
        })}
      </div>

      {/* Impact flash for each statement */}
      {STATEMENTS.map((stmt, i) => {
        const elapsed = frame - stmt.startFrame;
        if (elapsed < 0 || elapsed > 5) return null;
        return (
          <AbsoluteFill
            key={`flash-${i}`}
            style={{
              backgroundColor: COLORS.white,
              opacity: interpolate(elapsed, [0, 5], [0.15, 0]),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
