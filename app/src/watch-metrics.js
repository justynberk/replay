// Coverage is measured on the finished timeline, independent of replayed seconds.
export function mergeCoverage(ranges) {
  const merged = [];
  for (const [start, end] of ranges.map(r => [...r]).sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1] + .000001) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export const coverageOf = ranges => Math.min(1, ranges.reduce((sum, [start, end]) => sum + end - start, 0));

export function createWatchMeter(duration) {
  let previous = null, watchedSeconds = 0, ranges = [];
  return {
    reset() { previous = null; },
    sample({ position, now, active, rate = 1 }) {
      const next = { position, now, active };
      if (previous && previous.active && active && duration > 0) {
        const elapsed = (now - previous.now) / 1000, advanced = position - previous.position;
        // Long scheduling gaps and jumps are not evidence of watching.
        if (elapsed > 0 && elapsed <= 2 && advanced > 0 && advanced <= elapsed * rate + .15) {
          watchedSeconds += Math.min(elapsed, advanced / rate);
          ranges = mergeCoverage([...ranges, [Math.max(0, previous.position / duration), Math.min(1, position / duration)]]);
        }
      }
      previous = next;
    },
    snapshot() { return { watchedSeconds, ranges: ranges.map(r => [...r]) }; },
  };
}
