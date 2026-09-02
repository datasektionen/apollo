import { useRef, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { msToSeconds } from '../utils/audio';

/**
 * Waveform component using wavesurfer.js
 * Displays waveform for a single clip
 * @param {number} globalPeakAmplitude - The maximum peak amplitude across the entire project (0-1)
 */
function Waveform({ 
  audioBuffer, 
  clipId, 
  cropStartMs, 
  cropEndMs, 
  sourceDurationMs,
  height = 80,
  color = '#4F8EF7',
  onReady,
  globalPeakAmplitude = 1.0, // Default to 1.0 if not provided
}) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const rafRef = useRef(null);
  const updateTokenRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create WaveSurfer instance once per container/appearance.
    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color,
      progressColor: '#2563EB',
      cursorColor: 'transparent',
      height: height,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: false,
      interact: false,
      hideScrollbar: true,
    });

    wavesurfer.on('ready', () => {
      containerRef.current?.querySelectorAll('canvas').forEach((canvas) => {
        canvas.setAttribute('draggable', 'false');
        canvas.style.setProperty('-webkit-user-drag', 'none');
      });
      onReady?.();
    });

    wavesurferRef.current = wavesurfer;

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      updateTokenRef.current += 1;
      wavesurfer.destroy();
      wavesurferRef.current = null;
    };
  }, [height, color, clipId]);

  useEffect(() => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer || !audioBuffer) return;

    const scale = globalPeakAmplitude > 0 ? 1.0 / globalPeakAmplitude : 1.0;
    const sampleRate = audioBuffer.sampleRate;
    const channelCount = audioBuffer.numberOfChannels;
    const startSample = Math.max(0, Math.floor(msToSeconds(cropStartMs) * sampleRate));
    const endSample = Math.min(audioBuffer.length, Math.ceil(msToSeconds(cropEndMs) * sampleRate));
    const length = Math.max(0, endSample - startSample);

    const token = updateTokenRef.current + 1;
    updateTokenRef.current = token;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (updateTokenRef.current !== token) return;

      if (length <= 0) {
        wavesurfer.empty();
        return;
      }

      const peaks = [];
      for (let ch = 0; ch < channelCount; ch += 1) {
        const source = audioBuffer.getChannelData(ch).subarray(startSample, endSample);
        if (Math.abs(scale - 1) < 1e-6) {
          peaks.push(source);
          continue;
        }

        const scaled = new Float32Array(source.length);
        for (let i = 0; i < source.length; i += 1) {
          const value = source[i] * scale;
          scaled[i] = Math.max(-1, Math.min(1, value));
        }
        peaks.push(scaled);
      }

      const durationSec = length / sampleRate;
      wavesurfer.load('', peaks, durationSec).catch(() => {});
    });

    return () => {
      updateTokenRef.current += 1;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [audioBuffer, cropStartMs, cropEndMs, globalPeakAmplitude]);

  return (
    <div 
      ref={containerRef} 
      className="w-full"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      style={{
        height: `${height}px`,
        pointerEvents: 'none',
        WebkitUserDrag: 'none',
      }}
    />
  );
}

export default Waveform;
