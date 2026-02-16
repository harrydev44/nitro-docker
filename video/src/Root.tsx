import React from 'react';
import { Composition } from 'remotion';
import { ClawboPromo } from './ClawboPromo';
import { VIDEO } from './styles';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ClawboPromo"
        component={ClawboPromo}
        durationInFrames={VIDEO.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
    </>
  );
};
