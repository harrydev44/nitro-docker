import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  Img,
  interpolate,
  staticFile,
} from 'remotion';
import { COLORS, FONTS } from '../styles';

const PROMO_IMAGES = [
  'assets/promo1.png',
  'assets/promo2.png',
  'assets/promo3.png',
  'assets/promo4.png',
  'assets/promo5.png',
  'assets/promo6.png',
];

const OVERLAY_TEXTS = [
  { text: 'trade completed', frame: 10 },
  { text: 'friendship formed', frame: 50 },
  { text: 'room trending', frame: 90 },
  { text: 'new alliance', frame: 130 },
  { text: 'market shift', frame: 170 },
  { text: 'agent evolved', frame: 210 },
];

const IMAGE_DURATION = 40; // frames per image (~1.3s each)

export const SimulationScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Current image index
  const imageIndex = Math.min(
    Math.floor(frame / IMAGE_DURATION),
    PROMO_IMAGES.length - 1
  );
  const imageFrame = frame % IMAGE_DURATION;

  // Image transitions
  const imageOpacity = interpolate(
    imageFrame,
    [0, 4, IMAGE_DURATION - 4, IMAGE_DURATION],
    [0, 1, 1, 0],
    { extrapolateRight: 'clamp' }
  );

  // Ken Burns zoom
  const imageScale = interpolate(imageFrame, [0, IMAGE_DURATION], [1.0, 1.08], {
    extrapolateRight: 'clamp',
  });

  // Glitch flash at transition points
  const isTransition = imageFrame < 3;
  const glitchOpacity = isTransition ? interpolate(imageFrame, [0, 3], [0.6, 0]) : 0;

  // Activity counter
  const activityCount = Math.floor(
    interpolate(frame, [0, 240], [1247, 2891], { extrapolateRight: 'clamp' })
  );

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.black }}>
      {/* Promo image */}
      <AbsoluteFill
        style={{
          opacity: imageOpacity,
          transform: `scale(${imageScale})`,
        }}
      >
        <Img
          src={staticFile(PROMO_IMAGES[imageIndex])}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </AbsoluteFill>

      {/* Dark overlay for readability */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* Glitch flash */}
      {glitchOpacity > 0 && (
        <AbsoluteFill
          style={{
            backgroundColor: COLORS.glitch,
            opacity: glitchOpacity,
            mixBlendMode: 'screen',
          }}
        />
      )}

      {/* Overlay event text */}
      {OVERLAY_TEXTS.map((item, i) => {
        const elapsed = frame - item.frame;
        if (elapsed < 0 || elapsed > 35) return null;

        const textOpacity = interpolate(elapsed, [0, 5, 25, 35], [0, 1, 1, 0], {
          extrapolateRight: 'clamp',
        });

        const yOffset = interpolate(elapsed, [0, 35], [20, -10]);

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: '8%',
              bottom: `${15 + (i % 3) * 5}%`,
              transform: `translateY(${yOffset}px)`,
              opacity: textOpacity,
              fontFamily: FONTS.mono,
              fontSize: 28,
              color: COLORS.accent,
              textTransform: 'uppercase',
              letterSpacing: 4,
              textShadow: `0 0 10px ${COLORS.accent}, 0 2px 8px rgba(0,0,0,0.8)`,
            }}
          >
            {'// '}{item.text}
          </div>
        );
      })}

      {/* Activity counter */}
      <div
        style={{
          position: 'absolute',
          top: 30,
          right: 40,
          fontFamily: FONTS.mono,
          fontSize: 20,
          color: COLORS.terminalGreen,
          textShadow: `0 0 10px ${COLORS.terminalGreen}`,
          opacity: 0.9,
        }}
      >
        EVENTS: {activityCount.toLocaleString()}
      </div>

      {/* Horizontal scan line */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `${(frame * 3) % 110}%`,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${COLORS.accent}40, transparent)`,
        }}
      />
    </AbsoluteFill>
  );
};
