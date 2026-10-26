const colors = {
  sage: { light: '#CAD6BC', base: '#94A783', shade: '#657858' },
  clay: { light: '#E8B39A', base: '#C88062', shade: '#92563E' },
  cream: { light: '#F7EFDA', base: '#DED0B1', shade: '#AC9B7D' },
  blue: { light: '#C0D3DC', base: '#86A5B5', shade: '#57778A' },
  butter: { light: '#F7DF9C', base: '#DDB963', shade: '#A5873F' },
  brass: { light: '#E7D7A8', base: '#B8A06A', shade: '#79643E' },
  silver: { light: '#E3E8E3', base: '#ADB8B1', shade: '#6E7C76' }
};
const palettes = { pin: ['sage', 'clay', 'butter', 'cream', 'blue'], clip: ['clay', 'blue', 'cream', 'sage'], paperclip: ['brass', 'silver', 'blue'] };
const kinds = Object.keys(palettes);
function choose(random = Math.random) {
  const kind = kinds[Math.min(kinds.length - 1, Math.floor(random() * kinds.length))], palette = palettes[kind];
  return { kind, color: palette[Math.min(palette.length - 1, Math.floor(random() * palette.length))], rotation: Math.round(random() * 20 - 10) };
}
function valid(value) {
  return !!value && Object.prototype.hasOwnProperty.call(palettes, value.kind) && palettes[value.kind].includes(value.color) && Number.isFinite(value.rotation) && Math.abs(value.rotation) <= 10;
}
function of(placement) {
  if (valid(placement.fastener)) return placement.fastener;
  // Legacy placements receive a stable visual without changing stored data.
  // New placements choose once inside the same atomic write as their geometry.
  let seed = 2166136261;
  for (const c of `${placement.memoryId}:${placement.createdAt || 0}`) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  return choose(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
}
module.exports = { colors, palettes, choose, valid, of };
