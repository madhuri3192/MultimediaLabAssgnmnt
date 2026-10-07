"use client";

import { useEffect, useRef } from "react";

type AudioVisualizerProps = {
  analyser: AnalyserNode | null;
  className?: string;
};

const BAR_COUNT = 40;
const REDUCED_MOTION_FPS = 6;

export function AudioVisualizer({ analyser, className }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let frame = 0;
    let lastDraw = 0;

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      if (reducedMotion && now - lastDraw < 1000 / REDUCED_MOTION_FPS) return;
      lastDraw = now;

      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = getComputedStyle(canvas).color;

      const gap = 3;
      const barWidth = Math.max(2, (width - gap * (BAR_COUNT - 1)) / BAR_COUNT);
      const minHeight = 3;

      if (analyser && data) analyser.getByteFrequencyData(data);
      for (let i = 0; i < BAR_COUNT; i += 1) {
        // Sample lower frequencies more densely; that is where speech lives.
        const bin = data ? Math.floor((i / BAR_COUNT) ** 1.6 * data.length * 0.6) : 0;
        const level = data ? data[bin] / 255 : 0;
        const barHeight = minHeight + level * (height - minHeight);
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        context.fill();
      }
    };

    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [analyser]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
