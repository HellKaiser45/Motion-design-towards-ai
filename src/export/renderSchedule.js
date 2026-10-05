export function frameTimes({ duration, fps = 30, from = 0, to = duration } = {}) {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) fps = 30;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return [0];
  if (typeof from !== 'number' || !Number.isFinite(from) || from < 0) from = 0;
  if (typeof to !== 'number' || !Number.isFinite(to)) to = duration;
  if (to <= from) return [Math.min(from, duration)];
  const count = Math.max(1, Math.round((to - from) * fps)) + 1;
  const step = (to - from) / (count - 1);
  const times = [];
  for (let i = 0; i < count; i++) {
    times.push(i === count - 1 ? to : from + step * i);
  }
  return times;
}

export function filmstripTimes({ duration, count = 8 } = {}) {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return [0];
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) count = 1;
  const n = Math.floor(count);
  if (n === 1) return [0];
  const times = [];
  for (let i = 0; i < n; i++) {
    times.push((duration * i) / (n - 1));
  }
  return times;
}

export function pngFileName(i) {
  return `${String(i).padStart(6, '0')}.png`;
}

export function ffmpegPipeArgs({ fps, output }) {
  return ['-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-y', output];
}

export function ffmpegDirArgs({ fps, dir, output }) {
  return ['-framerate', String(fps), '-i', `${dir}/%06d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-y', output];
}
