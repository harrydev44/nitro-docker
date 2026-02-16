import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  Img,
  interpolate,
  spring,
  staticFile,
} from 'remotion';
import { COLORS, FONTS } from '../styles';

const TAGLINES = [
  { text: 'clawbo hotel', startFrame: 120, size: 44 },
  { text: 'a habbo hotel run entirely by AI', startFrame: 150, size: 30 },
  { text: 'the hotel never sleeps.', startFrame: 185, size: 28 },
];

export const TokenCloseScene: React.FC = () => {
  const frame = useCurrentFrame();

  // $CLAWBO token reveal
  const tokenScale = spring({
    frame,
    fps: 30,
    config: { damping: 10, stiffness: 100 },
    delay: 5,
  });

  const tokenOpacity = interpolate(frame, [5, 15], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Subtitle
  const subtitleOpacity = interpolate(frame, [35, 50], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Hotel return
  const hotelOpacity = interpolate(frame, [90, 115], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Gold pulse
  const goldPulse = interpolate(
    Math.sin(frame * 0.1),
    [-1, 1],
    [0.8, 1]
  );

  // Token and subtitle fade out as hotel section comes in
  const topSectionOpacity = interpolate(frame, [85, 110], [1, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.darkBg,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Radial glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 40%, rgba(255,215,0,0.08) 0%, transparent 60%)`,
          opacity: goldPulse,
        }}
      />

      {/* $CLAWBO token text */}
      <div
        style={{
          position: 'absolute',
          top: '30%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          opacity: topSectionOpacity,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.display,
            fontSize: 140,
            fontWeight: 900,
            color: COLORS.gold,
            transform: `scale(${tokenScale})`,
            opacity: tokenOpacity,
            textShadow: `0 0 40px ${COLORS.gold}, 0 0 80px ${COLORS.goldDark}, 0 4px 20px rgba(0,0,0,0.5)`,
            letterSpacing: 12,
          }}
        >
          $CLAWBO
        </div>
        <div
          style={{
            fontFamily: FONTS.body,
            fontSize: 28,
            color: COLORS.dimWhite,
            opacity: subtitleOpacity,
            letterSpacing: 6,
            textTransform: 'uppercase',
          }}
        >
          official token of the clawbo universe
        </div>
      </div>

      {/* Hotel section */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: hotelOpacity,
        }}
      >
        {/* Hotel image */}
        <div
          style={{
            marginBottom: 40,
            imageRendering: 'pixelated' as const,
          }}
        >
          <Img
            src={staticFile('assets/br_large.png')}
            style={{
              height: 450,
              filter: `drop-shadow(0 0 40px rgba(255,215,0,0.3))`,
            }}
          />
        </div>

        {/* Taglines */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          {TAGLINES.map((line, i) => {
            const elapsed = frame - line.startFrame;
            if (elapsed < 0) return null;

            const lineSpring = spring({
              frame: elapsed,
              fps: 30,
              config: { damping: 15, stiffness: 120 },
            });

            const isTitle = i === 0;

            return (
              <div
                key={i}
                style={{
                  fontFamily: isTitle ? FONTS.display : FONTS.body,
                  fontSize: line.size,
                  fontWeight: isTitle ? 900 : 400,
                  color: isTitle ? COLORS.white : COLORS.dimWhite,
                  textTransform: 'uppercase',
                  letterSpacing: isTitle ? 8 : 4,
                  opacity: lineSpring,
                  transform: `translateY(${(1 - lineSpring) * 20}px)`,
                  textShadow: isTitle
                    ? '0 0 20px rgba(255,255,255,0.3)'
                    : 'none',
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      </div>

      {/* Final fade to black */}
      <AbsoluteFill
        style={{
          backgroundColor: COLORS.black,
          opacity: interpolate(frame, [220, 240], [0, 1], {
            extrapolateRight: 'clamp',
          }),
        }}
      />
    </AbsoluteFill>
  );
};
