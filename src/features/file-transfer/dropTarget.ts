export function dropPositionInside(
  position: { x: number; y: number },
  bounds: { left: number; top: number; right: number; bottom: number },
  scale: number
) {
  const x = position.x / scale;
  const y = position.y / scale;
  return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
}
