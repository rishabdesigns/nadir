export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (from, to, amount) => from + (to - from) * amount;
export const inverseLerp = (from, to, value) => clamp((value - from) / (to - from));
export const smoothstep = (from, to, value) => {
  const t = inverseLerp(from, to, value);
  return t * t * (3 - 2 * t);
};
export const damp = (current, target, lambda, delta) => lerp(current, target, 1 - Math.exp(-lambda * delta));

