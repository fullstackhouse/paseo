interface Point {
  x: number;
  y: number;
}

/**
 * Where a viewport point lies in the box a CDP quad shows, in that box's own pixels. The quad's
 * corners are the box's top left, top right, bottom right and bottom left after CSS transforms,
 * so this is the inverse of the projection that takes the box onto them. Null for a flat quad.
 */
export function toBoxPoint(
  point: Point,
  quad: readonly number[],
  size: { width: number; height: number },
): Point | null {
  if (quad.length !== 8) return null;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = quad as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const sumX = x0 - x1 + x2 - x3;
  const sumY = y0 - y1 + y2 - y3;
  const determinant = (x1 - x2) * (y3 - y2) - (x3 - x2) * (y1 - y2);
  if (determinant === 0) return null;
  const g = (sumX * (y3 - y2) - (x3 - x2) * sumY) / determinant;
  const h = ((x1 - x2) * sumY - sumX * (y1 - y2)) / determinant;
  // The projection of the unit square onto the quad is [a b c; d e f; g h 1].
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;
  const { x, y } = point;
  const scale = (d * h - e * g) * x + (b * g - a * h) * y + (a * e - b * d);
  if (scale === 0) return null;
  return {
    x: (((e - f * h) * x + (c * h - b) * y + (b * f - c * e)) / scale) * size.width,
    y: (((f * g - d) * x + (a - c * g) * y + (c * d - a * f)) / scale) * size.height,
  };
}
