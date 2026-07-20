export interface Rng {
  next(): number;            // [0, 1)
  int(nExclusive: number): number;
  shuffle<T>(items: T[]): T[];
}

function make(nextFloat: () => number): Rng {
  const rng: Rng = {
    next: nextFloat,
    int: (n) => Math.floor(nextFloat() * n),
    shuffle: (items) => {
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(nextFloat() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    },
  };
  return rng;
}

export function makeSeeded(seed: number): Rng {
  let a = seed >>> 0;
  return make(() => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

export function makeRandom(): Rng {
  return make(() => Math.random());
}
