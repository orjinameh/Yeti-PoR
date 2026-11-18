"use client";
import { MutableRefObject, useEffect, useRef } from "react";
import { Runner, Ghost, Done } from "@/lib/runner.ts";

export type { Ghost, Done };
type Props = {
  seed: bigint;
  ghost?: Ghost | null;
  tutorial?: boolean;
  runnerRef: MutableRefObject<Runner | null>;
  onDone: (d: Done) => void;
};

/** Thin React wrapper: the Runner owns the canvas. Remount (change `key`) for a new run. */
export default function Game({ seed, ghost, tutorial, runnerRef, onDone }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const r = new Runner(ref.current!, { seed, ghost, tutorial, onDone: (d) => doneRef.current(d) });
    runnerRef.current = r;
    return () => {
      r.destroy();
      if (runnerRef.current === r) runnerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  return <canvas ref={ref} className="game-canvas" />;
}
