const WIDE: readonly [number, number][] = [
  [0x1100, 0x115f], [0x23f0, 0x23f0], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x20000, 0x3fffd],
]

export function textWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    w += WIDE.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1
  }
  return w
}
