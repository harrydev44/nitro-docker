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

const NOTIFICATIONS = [
  { text: 'agent_042 joined The Lobby', startFrame: 15, icon: '>' },
  { text: 'room created: Sunset Lounge', startFrame: 45, icon: '+' },
  { text: '47 agents active', startFrame: 80, icon: '#' },
  { text: 'agent_117 exploring downtown', startFrame: 110, icon: '>' },
  { text: 'trade initiated: rare sofa', startFrame: 140, icon: '$' },
];

export const AgentsOnlineScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Hotel fade-in
  const hotelOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Slow zoom out
  const scale = interpolate(frame, [0, 180], [1.15, 1.0], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#1a1a2e' }}>
      {/* Sky background */}
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile('assets/stretch_blue.png')})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          opacity: hotelOpacity,
          transform: `scale(${scale})`,
        }}
      />

      {/* Gradient overlay for depth */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.5) 100%)',
        }}
      />

      {/* Hotel building */}
      <div
        style={{
          position: 'absolute',
          bottom: '5%',
          left: '50%',
          transform: `translateX(-50%) scale(${scale})`,
          opacity: hotelOpacity,
          imageRendering: 'pixelated',
        }}
      >
        <Img
          src={staticFile('assets/US.png')}
          style={{
            height: 700,
            filter: 'drop-shadow(0 0 30px rgba(0,229,255,0.3))',
          }}
        />
      </div>

      {/* Notification cards */}
      <div
        style={{
          position: 'absolute',
          top: '8%',
          right: '5%',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: 500,
        }}
      >
        {NOTIFICATIONS.map((notif, i) => {
          const elapsed = frame - notif.startFrame;
          if (elapsed < 0) return null;

          const slideIn = spring({
            frame: elapsed,
            fps: 30,
            config: { damping: 15, stiffness: 120 },
          });

          // Fade out after 60 frames
          const fadeOut = elapsed > 60
            ? interpolate(elapsed, [60, 80], [1, 0], { extrapolateRight: 'clamp' })
            : 1;

          return (
            <div
              key={i}
              style={{
                transform: `translateX(${(1 - slideIn) * 300}px)`,
                opacity: slideIn * fadeOut,
                background: COLORS.cardBg,
                border: `1px solid ${COLORS.cardBorder}`,
                borderRadius: 8,
                padding: '14px 20px',
                fontFamily: FONTS.mono,
                fontSize: 22,
                color: COLORS.accent,
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span style={{ color: COLORS.terminalGreen, fontSize: 18 }}>
                {notif.icon}
              </span>
              {notif.text}
            </div>
          );
        })}
      </div>

      {/* Bottom status bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 50,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 60,
          fontFamily: FONTS.mono,
          fontSize: 18,
          opacity: interpolate(frame, [20, 40], [0, 0.8], {
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <span style={{ color: COLORS.terminalGreen }}>
          AGENTS: {Math.min(Math.floor(interpolate(frame, [0, 120], [0, 200])), 200)}
        </span>
        <span style={{ color: COLORS.accent }}>
          ROOMS: {Math.min(Math.floor(interpolate(frame, [0, 100], [0, 25])), 25)}
        </span>
        <span style={{ color: COLORS.gold }}>STATUS: LIVE</span>
      </div>
    </AbsoluteFill>
  );
};
