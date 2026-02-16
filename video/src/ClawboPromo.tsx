import React from 'react';
import { AbsoluteFill, Audio, Series, staticFile } from 'remotion';
import { BootScene } from './scenes/BootScene';
import { AgentsOnlineScene } from './scenes/AgentsOnlineScene';
import { SimulationScene } from './scenes/SimulationScene';
import { AITakeoverScene } from './scenes/AITakeoverScene';
import { TokenCloseScene } from './scenes/TokenCloseScene';
import { SCENES } from './styles';

export const ClawboPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Audio src={staticFile('assets/bgm.mp3')} volume={1} loop />
      <Series>
        <Series.Sequence durationInFrames={SCENES.boot.duration}>
          <BootScene />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.agentsOnline.duration}>
          <AgentsOnlineScene />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.simulation.duration}>
          <SimulationScene />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.aiTakeover.duration}>
          <AITakeoverScene />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.tokenClose.duration}>
          <TokenCloseScene />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
