import { describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';

function cliWithInput(input: string, seed = 42): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/cli/main.ts'], {
      env: { ...process.env, STRATEGO_SEED: String(seed) },
      timeout: 30_000,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.on('error', reject);
    child.on('close', () => resolve(out));
    child.stdin.write(input);
    child.stdin.end();
  });
}

describe('CLI E2E (piped input, seeded)', () => {
  test('help prints command list; quit exits cleanly', async () => {
    const out = await cliWithInput('help\nquit\n');
    expect(out).toContain('commands: move a2 a3');
    expect(out).toContain('Game over.');
  });

  test('unknown command and malformed squares produce error messages, not crashes', async () => {
    const out = await cliWithInput('flarp\nmove z9 a1\nmove a1\nquit\n');
    expect(out).toContain('unknown command: flarp');
    expect(out).toContain('bad square (use a1..j10)');
    expect(out).toContain('usage: move <from> <to>');
    expect(out).toContain('Game over.');
  });

  test('setup preset + done starts play and renders the board', async () => {
    const out = await cliWithInput('setup preset balanced\ndone\nquit\n');
    expect(out).toContain('(you are RED; UPPER=yours, lower=known enemy, ?=hidden, ~=lake)');
    expect(out).toContain('move> ');
  });

  test('setup random + done also reaches play', async () => {
    const out = await cliWithInput('setup random\ndone\nquit\n');
    expect(out).toContain('move> ');
  });

  test('a legal move is applied and the bot answers; resign ends the game', async () => {
    const out = await cliWithInput('setup preset balanced\ndone\nmove a4 a5\nresign\n');
    // Human moved without rejection…
    expect(out).not.toContain('rejected:');
    // …and the game ends by resignation with BLUE the winner.
    expect(out).toContain('GAME OVER: BLUE (RESIGN)');
    expect(out).toContain('Game over.');
  });

  test('illegal move is rejected with a reason and the game continues', async () => {
    // e5 = {r:5,c:4}, empty no-man's-land square untouched by "move a4 a5" (column a only) —
    // moving from an empty source square must be rejected, and the game keeps going to resign.
    const out = await cliWithInput('setup preset balanced\ndone\nmove e5 e7\nresign\n');
    expect(out).toContain('rejected:');
    expect(out).toContain('GAME OVER: BLUE (RESIGN)');
  });

  test('deterministic under a fixed seed: identical transcripts', async () => {
    const script = 'setup preset balanced\ndone\nmove a4 a5\nmove a5 a6\nresign\n';
    const [a, b] = await Promise.all([cliWithInput(script, 7), cliWithInput(script, 7)]);
    expect(a).toEqual(b);
  });
});
