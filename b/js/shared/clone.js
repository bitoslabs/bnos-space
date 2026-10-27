/**
 * Safe deep clone for plain JSON-shaped data.
 */
export function clone(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}
