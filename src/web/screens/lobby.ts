import type { Store } from '../main.js';
import type { BotKind, WatchSpeed } from '../../server/protocol.js';

function createFriend(store: Store): void {
  store.net.send({ t: 'CREATE_ROOM', mode: 'HUMAN_VS_HUMAN' });
}

function createBotGame(store: Store, difficulty: BotKind): void {
  store.net.send({ t: 'CREATE_ROOM', mode: 'HUMAN_VS_BOT', botDifficulty: difficulty });
}

function createWatch(store: Store, red: BotKind, blue: BotKind, speed: WatchSpeed): void {
  store.net.send({ t: 'CREATE_ROOM', mode: 'BOT_VS_BOT', bots: { RED: red, BLUE: blue }, watchSpeed: speed });
}

function joinRoom(store: Store, code: string): void {
  store.net.send({ t: 'JOIN_ROOM', code });
}

function parseSpeed(raw: string): WatchSpeed {
  if (raw === 'step') return 'step';
  return raw === '500' ? 500 : 1000;
}

/** Lobby fully owns `root.innerHTML` — it has no internal phase, so it never patches in place. */
export function render(root: HTMLElement, store: Store): void {
  // Sends queue while reconnecting (ws-client), but a stale click during a drop can still race a
  // reconnect the user isn't aware of — simplest fix is to just not offer the action yet.
  const isOpen = store.status === 'open';
  const disabledAttr = isOpen ? '' : 'disabled';

  root.innerHTML = `
    <h1>Stratego</h1>
    <div class="lobby-grid">
      <section class="card">
        <h2>Play a friend</h2>
        <p class="hint">Create a room, then share the code with someone to join.</p>
        <button type="button" data-action="create-friend" ${disabledAttr}>Create room</button>
      </section>

      <section class="card">
        <h2>Play the bot</h2>
        <div class="card-row">
          <label><input type="radio" name="bot-difficulty" value="random" checked /> Easy</label>
          <label><input type="radio" name="bot-difficulty" value="heuristic" /> Hard</label>
        </div>
        <button type="button" data-action="create-bot" ${disabledAttr}>Create room</button>
      </section>

      <section class="card">
        <h2>Watch bots</h2>
        <div class="card-row">
          <label>Red
            <select name="watch-red">
              <option value="random">Easy</option>
              <option value="heuristic" selected>Hard</option>
            </select>
          </label>
          <label>Blue
            <select name="watch-blue">
              <option value="random">Easy</option>
              <option value="heuristic" selected>Hard</option>
            </select>
          </label>
          <label>Speed
            <select name="watch-speed">
              <option value="500">Fast</option>
              <option value="1000" selected>Normal</option>
              <option value="step">Step</option>
            </select>
          </label>
        </div>
        <button type="button" data-action="create-watch" ${disabledAttr}>Create room</button>
      </section>

      <section class="card">
        <h2>Join a room</h2>
        <div class="card-row">
          <input name="join-code" maxlength="5" placeholder="CODE" autocapitalize="characters" autocomplete="off" />
          <button type="button" data-action="join" ${disabledAttr}>Join</button>
        </div>
        ${isOpen ? '' : '<p class="hint">Connecting…</p>'}
      </section>
    </div>
  `;

  root.querySelector<HTMLButtonElement>('[data-action="create-friend"]')
    ?.addEventListener('click', () => createFriend(store));

  root.querySelector<HTMLButtonElement>('[data-action="create-bot"]')
    ?.addEventListener('click', () => {
      const picked = root.querySelector<HTMLInputElement>('input[name="bot-difficulty"]:checked');
      createBotGame(store, (picked?.value as BotKind | undefined) ?? 'random');
    });

  root.querySelector<HTMLButtonElement>('[data-action="create-watch"]')
    ?.addEventListener('click', () => {
      const red = root.querySelector<HTMLSelectElement>('select[name="watch-red"]')?.value as BotKind;
      const blue = root.querySelector<HTMLSelectElement>('select[name="watch-blue"]')?.value as BotKind;
      const speed = parseSpeed(root.querySelector<HTMLSelectElement>('select[name="watch-speed"]')?.value ?? '1000');
      createWatch(store, red, blue, speed);
    });

  const joinInput = root.querySelector<HTMLInputElement>('input[name="join-code"]');
  joinInput?.addEventListener('input', () => {
    joinInput.value = joinInput.value.toUpperCase();
  });

  root.querySelector<HTMLButtonElement>('[data-action="join"]')
    ?.addEventListener('click', () => {
      const code = (joinInput?.value ?? '').trim().toUpperCase();
      if (code.length === 5) joinRoom(store, code);
    });
}
