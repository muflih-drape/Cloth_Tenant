export function getColorFromId(id: number) {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue}, 65%, 45%)`; // lighter for background
}
