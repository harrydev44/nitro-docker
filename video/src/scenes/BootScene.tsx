import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { COLORS, FONTS } from '../styles';

const LINES = [
  { text: '> booting clawbo hotel...', startFrame: 10 },
  { text: '> loading world...', startFrame: 35 },
  { text: '> spawning 200 agents...', startFrame: 55 },
  { text: '> [ONLINE]', startFrame: 85 },
];

const TYPING_SPEED = 2; // frames per character

export const BootScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // CRT flicker
  const flicker = Math.sin(frame * 0.5) * 0.03 + 1;

  // Scanline offset for animation
  const scanlineOffset = (frame * 2) % 4;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.black,
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '15% 18%',
      }}
    >
      {/* Terminal lines */}
      <div style={{ opacity: flicker }}>
        {LINES.map((line, i) => {
          const elapsed = frame - line.startFrame;
          if (elapsed < 0) return null;

          const charsVisible = Math.min(
            Math.floor(elapsed / TYPING_SPEED),
            line.text.length
          );
          const displayText = line.text.slice(0, charsVisible);
          const isOnline = line.text.includes('[ONLINE]');
          const showCursor =
            charsVisible < line.text.length && i === LINES.findIndex((l) => frame >= l.startFrame && frame < l.startFrame + l.text.length * TYPING_SPEED);

          // Flash effect for [ONLINE]
          const onlineOpacity = isOnline && charsVisible >= line.text.length
            ? interpolate(
                (frame - (line.startFrame + line.text.length * TYPING_SPEED)) % 20,
                [0, 10, 20],
                [1, 0.6, 1]
              )
            : 1;

          return (
            <div
              key={i}
              style={{
                fontFamily: FONTS.mono,
                fontSize: 42,
                color: isOnline && charsVisible >= line.text.length
                  ? COLORS.terminalGreen
                  : COLORS.terminalDim,
                marginBottom: 20,
                opacity: onlineOpacity,
                textShadow: isOnline && charsVisible >= line.text.length
                  ? `0 0 20px ${COLORS.terminalGreen}, 0 0 40px ${COLORS.terminalGreen}`
                  : `0 0 10px ${COLORS.terminalDim}`,
                letterSpacing: 2,
              }}
            >
              {displayText}
              {showCursor && (
                <span
                  style={{
                    opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
                  }}
                >
                  _
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* CRT Scanlines overlay */}
      <AbsoluteFill
        style={{
          background: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent ${2 + scanlineOffset}px,
            rgba(0, 255, 65, 0.03) ${2 + scanlineOffset}px,
            rgba(0, 255, 65, 0.03) ${4 + scanlineOffset}px
          )`,
          pointerEvents: 'none',
        }}
      />

      {/* CRT vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Screen flash when ONLINE hits */}
      {frame >= 85 + LINES[3].text.length * TYPING_SPEED && frame < 85 + LINES[3].text.length * TYPING_SPEED + 6 && (
        <AbsoluteFill
          style={{
            backgroundColor: COLORS.terminalGreen,
            opacity: interpolate(
              frame - (85 + LINES[3].text.length * TYPING_SPEED),
              [0, 6],
              [0.3, 0]
            ),
          }}
        />
      )}
    </AbsoluteFill>
  );
};
