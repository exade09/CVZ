import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(args) {
  const options = {
    cdp: "http://127.0.0.1:9222",
    url: "http://127.0.0.1:4173/",
    timeout: 20_000,
    screenshot: resolve(workspaceRoot, "tmp", "browser-smoke.png"),
  };
  for (let index = 0; index < args.length; index += 1) {
    const separator = args[index].indexOf("=");
    const name = separator >= 0 ? args[index].slice(0, separator) : args[index];
    const value = separator >= 0 ? args[index].slice(separator + 1) : args[++index];
    if (!value) throw new Error(`Missing value for ${name}.`);
    if (name === "--cdp") options.cdp = value.replace(/\/$/u, "");
    else if (name === "--url") options.url = value;
    else if (name === "--timeout") options.timeout = Number(value);
    else if (name === "--screenshot") options.screenshot = resolve(workspaceRoot, value);
    else throw new Error(`Unknown option: ${name}`);
  }
  if (!Number.isFinite(options.timeout) || options.timeout < 1_000) throw new Error("Timeout must be at least 1000ms.");
  const tmpRoot = resolve(workspaceRoot, "tmp");
  if (options.screenshot !== tmpRoot && !options.screenshot.startsWith(`${tmpRoot}\\`) && !options.screenshot.startsWith(`${tmpRoot}/`)) {
    throw new Error("The screenshot must be written inside the workspace tmp directory.");
  }
  return options;
}

class Cdp {
  constructor(url, timeout) {
    this.url = url;
    this.timeout = timeout;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error("CDP WebSocket connection timed out.")), this.timeout);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolveOpen();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        rejectOpen(new Error("CDP WebSocket connection failed."));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => this.onMessage(event.data));
    this.socket.addEventListener("close", () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error("CDP WebSocket closed."));
      }
      this.pending.clear();
    });
  }

  async onMessage(data) {
    const text = typeof data === "string" ? data : data instanceof Blob ? await data.text() : Buffer.from(data).toString("utf8");
    const message = JSON.parse(text);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCommand(new Error(`${method} timed out.`));
      }, this.timeout);
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(listener) {
    this.listeners.add(listener);
  }

  close() {
    this.socket?.close();
  }
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function createTarget(cdpBase) {
  const endpoint = `${cdpBase}/json/new?${encodeURIComponent("about:blank")}`;
  const response = await fetch(endpoint, { method: "PUT" });
  if (!response.ok) throw new Error(`Unable to create CDP target: HTTP ${response.status}.`);
  return response.json();
}

async function closeTarget(cdpBase, targetId) {
  await fetch(`${cdpBase}/json/close/${encodeURIComponent(targetId)}`).catch(() => {});
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
}

async function waitFor(cdp, expression, label, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` ${lastError.message}` : ""}`);
}

async function click(cdp, selector) {
  const result = await evaluate(cdp, `(() => {
    const elements = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const element = elements.find((candidate) => {
      const style = getComputedStyle(candidate);
      return !candidate.disabled && !candidate.hidden && style.display !== "none" && style.visibility !== "hidden" && candidate.getClientRects().length;
    });
    if (!element) return false;
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return true;
  })()`);
  if (!result) throw new Error(`Clickable element not found: ${selector}`);
}

async function setViewport(cdp, viewport) {
  const mobile = Boolean(viewport.mobile);
  await Promise.all([
    cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile,
      ...(mobile ? { screenOrientation: { type: viewport.width >= viewport.height ? "landscapePrimary" : "portraitPrimary", angle: viewport.width >= viewport.height ? 90 : 0 } } : {}),
    }),
    cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 }),
  ]);
  await delay(180);
}

async function tap(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement) || element.hidden || element.disabled || !element.getClientRects().length) return null;
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Touchable element not found: ${selector}`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function assertGameplayGeometry(cdp, viewport) {
  await setViewport(cdp, viewport);
  const geometry = await evaluate(cdp, `(() => {
    const screen = document.querySelector('#kvz-game-root .kvz-game-screen');
    const wrapper = document.querySelector('#kvz-game-root .kvz-game-battlefield-wrap');
    const board = document.querySelector('#kvz-game-root .kvz-game-battlefield');
    const close = document.querySelector('#kvz-game-root [data-app-action="close"]');
    if (!(screen instanceof HTMLElement) || !(wrapper instanceof HTMLElement) || !(board instanceof HTMLElement) || !(close instanceof HTMLElement)) return null;
    const wrapperRect = wrapper.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    return {
      cells: board.querySelectorAll('.kvz-game-cell').length,
      boardWidth: boardRect.width,
      boardHeight: boardRect.height,
      boardInside: boardRect.top >= wrapperRect.top - 1 && boardRect.bottom <= wrapperRect.bottom + 1 && boardRect.left >= wrapperRect.left - 1 && boardRect.right <= wrapperRect.right + 1,
      screenOverflow: screen.scrollHeight - screen.clientHeight,
      closeInside: closeRect.left >= 0 && closeRect.top >= 0 && closeRect.right <= innerWidth && closeRect.bottom <= innerHeight,
      laneHeight: boardRect.height / 5,
    };
  })()`);
  const label = `${viewport.width}x${viewport.height}`;
  assert(geometry?.cells === 45, `${label}: battlefield cells are incomplete.`);
  assert(geometry.boardInside, `${label}: battlefield is cropped by its wrapper (${JSON.stringify(geometry)}).`);
  assert(geometry.screenOverflow <= 2, `${label}: gameplay screen has vertical overflow (${geometry.screenOverflow}px).`);
  assert(geometry.closeInside, `${label}: close control is outside the viewport.`);
  assert(geometry.laneHeight >= 40, `${label}: lanes are too short for reliable placement (${geometry.laneHeight}px).`);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function remoteText(argument) {
  if (Object.hasOwn(argument, "value")) return typeof argument.value === "string" ? argument.value : JSON.stringify(argument.value);
  return argument.description ?? argument.type ?? "unknown";
}

async function run(options) {
  const target = await createTarget(options.cdp);
  const cdp = new Cdp(target.webSocketDebuggerUrl, options.timeout);
  const errors = [];
  const requests = new Map();
  const siteOrigin = new URL(options.url).origin;
  let screenshotWritten = false;

  try {
    await cdp.connect();
    cdp.on((message) => {
      if (message.method === "Network.requestWillBeSent") requests.set(message.params.requestId, message.params.request.url);
      if (message.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(message.params.type)) {
        errors.push(`Console: ${message.params.args.map(remoteText).join(" ")}`);
      }
      if (message.method === "Runtime.exceptionThrown") {
        errors.push(`Page: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
      }
      if (message.method === "Network.loadingFailed" && !message.params.canceled) {
        const url = requests.get(message.params.requestId) ?? "unknown URL";
        if (url.startsWith(siteOrigin)) errors.push(`Network: ${url} - ${message.params.errorText}`);
      }
      if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
        const { url, status } = message.params.response;
        if (url.startsWith(siteOrigin)) errors.push(`Network: ${url} returned HTTP ${status}`);
      }
    });

    await Promise.all([
      cdp.send("Page.enable"),
      cdp.send("Runtime.enable"),
      cdp.send("Network.enable"),
      cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }),
    ]);
    const navigation = await cdp.send("Page.navigate", { url: options.url });
    if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
    await waitFor(cdp, "document.readyState === 'complete'", "landing page load", options.timeout);
    await waitFor(cdp, "Boolean(document.querySelector('button.game-launch-button[data-kvz-open-game]'))", "game CTA", options.timeout);
    await evaluate(cdp, "localStorage.removeItem('cat-garden-defense.save.v1')");
    await click(cdp, "button.game-launch-button[data-kvz-open-game]");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-game-root:not([hidden]) #kvz-menu-title'))", "game menu", options.timeout);

    const menu = await evaluate(cdp, `({
      title: document.querySelector('#kvz-menu-title')?.textContent?.trim(),
      screen: document.querySelector('[data-screen-title]')?.textContent?.trim(),
      continueDisabled: document.querySelector('#kvz-game-root button[data-action="continue"]')?.disabled
    })`);
    assert(menu?.title === "Paws & Peril" && menu?.screen === "Main Menu" && menu?.continueDisabled === true, "Fresh main menu or Continue state did not render correctly.");

    await click(cdp, "#kvz-game-root button[data-action='cats']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-cats-title'))", "Cat Collection", options.timeout);
    const catCount = await evaluate(cdp, "document.querySelectorAll('#kvz-game-root section[aria-labelledby=\"kvz-cats-title\"] > .kvz-game-codex-grid > article.kvz-game-codex-card').length");
    assert(catCount === 8, `Expected 8 cat cards, found ${catCount}.`);

    await click(cdp, "#kvz-game-root button[data-app-action='back']:not([hidden])");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-menu-title'))", "main menu return", options.timeout);
    await click(cdp, "#kvz-game-root button[data-action='dogs']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-dogs-title'))", "Dog Encyclopedia", options.timeout);
    const dogCount = await evaluate(cdp, "document.querySelectorAll('#kvz-game-root section[aria-labelledby=\"kvz-dogs-title\"] > .kvz-game-codex-grid > article.kvz-game-codex-card').length");
    assert(dogCount === 5, `Expected 5 dog cards, found ${dogCount}.`);

    await click(cdp, "#kvz-game-root button[data-app-action='back']:not([hidden])");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-menu-title'))", "main menu return", options.timeout);
    await click(cdp, "#kvz-game-root button[data-action='levels']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-levels-title'))", "level selection", options.timeout);
    await click(cdp, "#kvz-game-root button[data-action='start-level'][data-level-id='level-1']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-game-root .kvz-game-gameplay'))", "level 1 gameplay", options.timeout);

    const hud = await evaluate(cdp, `({
      level: document.querySelector('[data-level-name]')?.textContent?.trim(),
      energy: Number(document.querySelector('[data-energy]')?.textContent),
      wave: document.querySelector('[data-wave-label]')?.textContent?.trim(),
      cells: document.querySelectorAll('.kvz-game-cell').length,
      sweepers: document.querySelectorAll('.kvz-game-sweeper').length,
      cards: document.querySelectorAll('.kvz-game-card').length,
      hud: Boolean(document.querySelector('.kvz-game-hud'))
    })`);
    assert(hud?.level === "First Pawprints", `Expected level 1, found ${hud?.level ?? "none"}.`);
    assert(hud.hud && hud.energy === 175 && hud.wave === "Wave 1 of 3" && hud.cells === 45 && hud.sweepers === 5 && hud.cards === 3, "Level 1 HUD or battlefield structure is invalid.");

    await click(cdp, ".kvz-game-card[data-defender-id='bubble-sprout']");
    await waitFor(cdp, "document.querySelector('.kvz-game-card[data-defender-id=\"bubble-sprout\"]')?.getAttribute('aria-pressed') === 'true'", "defender selection", options.timeout);
    await click(cdp, ".kvz-game-cell[data-lane='2'][data-column='2']");
    await waitFor(cdp, "document.querySelectorAll('.kvz-game-defender').length === 1 && Number(document.querySelector('[data-energy]')?.textContent) === 75", "defender placement", options.timeout);
    await waitFor(cdp, "Boolean(document.querySelector('.kvz-game-enemy')) && Boolean(document.querySelector('.kvz-game-energy-orb'))", "enemy and Paw Energy entities", options.timeout);
    await click(cdp, ".kvz-game-energy-orb");
    await waitFor(cdp, "Number(document.querySelector('[data-energy]')?.textContent) === 100", "Paw Energy collection", options.timeout);

    await click(cdp, "button[data-game-action='pause'][aria-label='Pause game']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-game-root.is-paused .kvz-game-modal-backdrop:not([hidden]) #kvz-pause-title'))", "pause state", options.timeout);
    const pausedHotkeyIgnored = await evaluate(cdp, `(() => {
      const before = document.querySelector('.kvz-game-card[aria-pressed="true"]')?.dataset.defenderId ?? null;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', bubbles: true }));
      const after = document.querySelector('.kvz-game-card[aria-pressed="true"]')?.dataset.defenderId ?? null;
      return before === after;
    })()`);
    assert(pausedHotkeyIgnored, "Defender hotkeys remain active behind the pause dialog.");
    await click(cdp, ".kvz-game-modal-backdrop:not([hidden]) button[data-app-action='resume-game']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-game-root:not(.is-paused) .kvz-game-gameplay:not(.is-paused)')) && document.querySelector('.kvz-game-modal-backdrop')?.hidden", "resume state", options.timeout);
    await waitFor(cdp, "parseFloat(document.querySelector('.kvz-game-enemy')?.style.left ?? '101') < 98", "visible enemy movement", options.timeout);

    await click(cdp, "#kvz-game-root button[data-app-action='fullscreen']");
    await waitFor(cdp, "document.fullscreenElement?.id === 'kvz-game-root' || [...document.querySelectorAll('.kvz-game-toast')].some((toast) => toast.textContent.includes('not available'))", "full-screen response", options.timeout);
    if (await evaluate(cdp, "document.fullscreenElement?.id === 'kvz-game-root'")) {
      assert(await evaluate(cdp, "document.querySelector('#kvz-game-root [data-app-action=\"fullscreen\"]')?.getAttribute('aria-label') === 'Exit full screen'"), "Full-screen control did not expose its exit state.");
      await click(cdp, "#kvz-game-root button[data-app-action='fullscreen']");
      await waitFor(cdp, "document.fullscreenElement === null", "full-screen exit", options.timeout);
      assert(await evaluate(cdp, "document.querySelector('#kvz-game-root [data-app-action=\"fullscreen\"]')?.getAttribute('aria-label') === 'Enter full screen'"), "Full-screen control did not restore its entry state.");
    }

    const targetViewports = [
      { width: 1920, height: 1080, mobile: false },
      { width: 1440, height: 900, mobile: false },
      { width: 1366, height: 768, mobile: false },
      { width: 1024, height: 768, mobile: false },
      { width: 1024, height: 600, mobile: true },
      { width: 844, height: 390, mobile: true },
      { width: 740, height: 360, mobile: true },
    ];
    for (const viewport of targetViewports) await assertGameplayGeometry(cdp, viewport);
    await setViewport(cdp, { width: 1440, height: 900, mobile: false });

    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const png = Buffer.from(screenshot.data, "base64");
    assert(png.length > 1_000 && png.subarray(1, 4).toString("ascii") === "PNG", "CDP returned an invalid PNG screenshot.");
    await mkdir(dirname(options.screenshot), { recursive: true });
    await writeFile(options.screenshot, png);
    screenshotWritten = true;

    await setViewport(cdp, { width: 390, height: 844, mobile: true });
    await waitFor(cdp, "document.querySelector('#kvz-game-root')?.classList.contains('orientation-blocked') && document.querySelector('.kvz-game-gameplay')?.classList.contains('is-paused')", "portrait orientation pause", options.timeout);
    await setViewport(cdp, { width: 844, height: 390, mobile: true });
    await waitFor(cdp, "!document.querySelector('#kvz-game-root')?.classList.contains('orientation-blocked') && !document.querySelector('.kvz-game-gameplay')?.classList.contains('is-paused')", "landscape orientation resume", options.timeout);
    const mobileCardCosts = await evaluate(cdp, `([...document.querySelectorAll('.kvz-game-card')].map((card) => {
      const cost = card.querySelector('.kvz-game-card-cost');
      const cardRect = card.getBoundingClientRect();
      const costRect = cost?.getBoundingClientRect();
      return Boolean(cost?.textContent?.trim() && costRect && costRect.height >= 15 && costRect.top >= cardRect.top - 1 && costRect.bottom <= cardRect.bottom + 1);
    }))`);
    assert(mobileCardCosts?.length === 3 && mobileCardCosts.every(Boolean), "Paw Energy costs are hidden or cropped on mobile defender cards.");
    const mobileScreenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const mobilePath = options.screenshot.replace(/\.png$/iu, "-mobile.png");
    await writeFile(mobilePath, Buffer.from(mobileScreenshot.data, "base64"));

    await click(cdp, "button[data-game-action='pause'][aria-label='Pause game']");
    await waitFor(cdp, "Boolean(document.querySelector('.kvz-game-modal-backdrop:not([hidden]) button[data-app-action=\"restart-level\"]'))", "restart control", options.timeout);
    await click(cdp, ".kvz-game-modal-backdrop:not([hidden]) button[data-app-action='restart-level']");
    await waitFor(cdp, "Boolean(document.querySelector('.kvz-game-gameplay')) && Number(document.querySelector('[data-energy]')?.textContent) === 175 && document.querySelectorAll('.kvz-game-defender').length === 0", "level restart", options.timeout);
    await tap(cdp, ".kvz-game-card[data-defender-id='bubble-sprout']");
    await tap(cdp, ".kvz-game-cell[data-lane='2'][data-column='2']");
    await waitFor(cdp, "document.querySelectorAll('.kvz-game-defender').length === 1 && Number(document.querySelector('[data-energy]')?.textContent) === 75", "touch defender placement", options.timeout);

    await evaluate(cdp, "history.back()");
    await waitFor(cdp, "document.querySelector('#kvz-game-root')?.hidden === true && !document.body.classList.contains('kvz-game-open') && history.state?.kvzGameOpen !== true", "browser Back closes the game", options.timeout);
    await evaluate(cdp, "history.forward()");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-game-root:not([hidden]) .kvz-game-modal-backdrop:not([hidden]) #kvz-pause-title'))", "browser Forward restores paused game", options.timeout);
    await click(cdp, ".kvz-game-modal-backdrop:not([hidden]) button[data-app-action='return-site']");
    await waitFor(cdp, "document.querySelector('#kvz-game-root')?.hidden === true && !document.body.classList.contains('kvz-game-open') && history.state?.kvzGameOpen !== true", "return to website", options.timeout);
    await evaluate(cdp, "window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    await click(cdp, "button.game-launch-button[data-kvz-open-game]");
    await waitFor(cdp, "document.querySelector('#kvz-game-root')?.isConnected && document.querySelector('#kvz-game-root')?.hidden === false", "back-forward cache restoration", options.timeout);
    await click(cdp, ".kvz-game-modal-backdrop:not([hidden]) button[data-app-action='quit-game']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-menu-title'))", "menu after cached gameplay", options.timeout);
    await click(cdp, "#kvz-game-root button[data-action='settings']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-settings-title'))", "settings screen", options.timeout);
    await click(cdp, "#kvz-game-root button[data-action='reset-progress']");
    await click(cdp, ".kvz-game-modal-backdrop:not([hidden]) button[data-app-action='confirm-reset']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-settings-title')) && localStorage.getItem('cat-garden-defense.save.v1') === null", "confirmed local progress reset", options.timeout);
    await click(cdp, "#kvz-game-root button[data-app-action='close']");
    await waitFor(cdp, "document.querySelector('#kvz-game-root')?.hidden === true && history.state?.kvzGameOpen !== true", "settings return to website", options.timeout);

    const campaignSave = {
      version: 2,
      completedLevels: ["level-1", "level-2"],
      unlockedCats: ["bubble-sprout", "sunny-bloom", "shell-guard", "twin-berry", "frost-bloom", "pop-burst", "leaf-beast", "bulb-guide"],
      encounteredDogs: ["stray-dog", "cone-dog", "bucket-dog", "gate-dog", "brute-dog"],
      settings: { musicVolume: 0.65, sfxVolume: 0.8, masterMuted: true, reducedMotion: false, screenShake: true },
      campaignProgress: { highestUnlockedLevel: 3, lastCompletedLevel: "level-2", hasStarted: true },
      lastSelectedLevel: "level-3",
    };
    await evaluate(cdp, `localStorage.setItem('cat-garden-defense.save.v1', ${JSON.stringify(JSON.stringify(campaignSave))})`);
    await setViewport(cdp, { width: 1440, height: 900, mobile: false });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitFor(cdp, "document.readyState === 'complete' && Boolean(document.querySelector('button.game-launch-button[data-kvz-open-game]'))", "campaign reload", options.timeout);
    await click(cdp, "button.game-launch-button[data-kvz-open-game]");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-menu-title'))", "restored campaign menu", options.timeout);
    assert(await evaluate(cdp, "document.querySelector('#kvz-game-root button[data-action=\"continue\"]')?.disabled === false"), "Continue did not enable for restored campaign progress.");
    await click(cdp, "#kvz-game-root button[data-action='levels']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-levels-title'))", "restored level selection", options.timeout);

    await click(cdp, "#kvz-game-root button[data-action='start-level'][data-level-id='level-2']");
    await waitFor(cdp, "document.querySelector('[data-level-name]')?.textContent?.trim() === 'Tin and Tangerine' && document.querySelectorAll('.kvz-game-card').length === 5 && Number(document.querySelector('[data-energy]')?.textContent) === 225", "level 2 gameplay", options.timeout);
    await waitFor(cdp, "Boolean(document.querySelector('.kvz-game-enemy'))", "level 2 enemy spawn", options.timeout);
    await click(cdp, "button[data-game-action='pause']");
    await click(cdp, ".kvz-game-modal-backdrop:not([hidden]) button[data-app-action='level-select']");
    await waitFor(cdp, "Boolean(document.querySelector('#kvz-levels-title'))", "level selection after level 2", options.timeout);

    await click(cdp, "#kvz-game-root button[data-action='start-level'][data-level-id='level-3']");
    await waitFor(cdp, "document.querySelector('[data-level-name]')?.textContent?.trim() === 'Moonlit Garden Stand' && document.querySelectorAll('.kvz-game-card').length === 8 && Number(document.querySelector('[data-energy]')?.textContent) === 350", "level 3 gameplay", options.timeout);
    const cardCopyVisible = await evaluate(cdp, `(() => {
      const description = document.querySelector('.kvz-game-card .kvz-game-card-description');
      return Boolean(description?.textContent?.trim() && description.getBoundingClientRect().height > 4);
    })()`);
    assert(cardCopyVisible, "Defender card descriptions are still clipped.");
    const denseCardLayout = await evaluate(cdp, `([...document.querySelectorAll('.kvz-game-card')].map((card) => {
      const description = card.querySelector('.kvz-game-card-description')?.getBoundingClientRect();
      const cost = card.querySelector('.kvz-game-card-cost')?.getBoundingClientRect();
      return { id: card.dataset.defenderId, descriptionBottom: description?.bottom ?? null, costTop: cost?.top ?? null };
    }))`);
    const overlappingCard = denseCardLayout?.find((card) => card.descriptionBottom === null || card.costTop === null || card.descriptionBottom > card.costTop + 0.5);
    assert(!overlappingCard, `Dense defender card descriptions overlap their Paw Energy costs: ${JSON.stringify(overlappingCard)}.`);
    await click(cdp, ".kvz-game-card[data-defender-id='leaf-beast']");
    await click(cdp, ".kvz-game-cell[data-lane='2'][data-column='2']");
    await waitFor(cdp, "document.querySelector('.kvz-game-defender[data-unit-id=\"leaf-beast\"]') && Number(document.querySelector('[data-energy]')?.textContent) === 100", "level 3 heavy defender placement", options.timeout);
    await waitFor(cdp, "parseFloat(document.querySelector('.kvz-game-enemy')?.style.left ?? '101') < 98", "visible level 3 enemy", options.timeout);
    const levelThreeShot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const levelThreePath = options.screenshot.replace(/\.png$/iu, "-level3.png");
    await writeFile(levelThreePath, Buffer.from(levelThreeShot.data, "base64"));
    await assertGameplayGeometry(cdp, { width: 844, height: 390, mobile: true });
    const denseMobileCards = await evaluate(cdp, `(async () => {
      const tray = document.querySelector('.kvz-game-card-tray');
      const cards = [...document.querySelectorAll('.kvz-game-card')];
      if (!(tray instanceof HTMLElement)) return null;
      const costsFit = cards.every((card) => {
        const cost = card.querySelector('.kvz-game-card-cost')?.getBoundingClientRect();
        const bounds = card.getBoundingClientRect();
        return Boolean(cost && cost.height >= 15 && cost.top >= bounds.top - 1 && cost.bottom <= bounds.bottom + 1);
      });
      const descriptionsHidden = cards.every((card) => getComputedStyle(card.querySelector('.kvz-game-card-description')).display === 'none');
      const scrollable = tray.scrollHeight > tray.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(tray).overflowY);
      tray.scrollTop = tray.scrollHeight;
      await new Promise(requestAnimationFrame);
      const trayBounds = tray.getBoundingClientRect();
      const lastBounds = cards.at(-1)?.getBoundingClientRect();
      const lastCardReachable = Boolean(lastBounds && lastBounds.bottom <= trayBounds.bottom + 1 && lastBounds.top >= trayBounds.top - 1);
      return { count: cards.length, costsFit, descriptionsHidden, scrollable, lastCardReachable };
    })()`);
    assert(denseMobileCards?.count === 8 && denseMobileCards.costsFit && denseMobileCards.descriptionsHidden && denseMobileCards.scrollable && denseMobileCards.lastCardReachable, `Dense mobile card tray is not usable: ${JSON.stringify(denseMobileCards)}.`);
    await click(cdp, "#kvz-game-root button[data-app-action='close']");
    await waitFor(cdp, "document.querySelector('#kvz-game-root')?.hidden === true && history.state?.kvzGameOpen !== true", "final campaign close", options.timeout);

    await setViewport(cdp, { width: 1366, height: 768, mobile: false });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitFor(cdp, "document.readyState === 'complete'", "terminal-state diagnostic reload", options.timeout);
    const pausedLifecycle = await evaluate(cdp, `(async () => {
      localStorage.removeItem('cat-garden-defense.save.v1');
      const { GardenGameApp } = await import('./game/game-app.js');
      const app = new GardenGameApp();
      globalThis.__kvzAuditApp = app;
      await app.open();
      await app.startLevel('level-1');
      app.pauseGame('manual');
      app.close(true);
      await app.open();
      const reopenedPaused = app.engine?.getState().status === 'paused' && app.audio.suspendedByApp === true && !app.modalBackdrop.hidden;
      app.showMenu();
      return { reopenedPaused, menuAudioActive: app.audio.suspendedByApp === false };
    })()`);
    assert(pausedLifecycle?.reopenedPaused, "A closed paused level did not reopen paused with audio suspended.");
    assert(pausedLifecycle?.menuAudioActive, "Leaving Pause for the menu did not reactivate audio state.");

    const victoryResult = await evaluate(cdp, `(async () => {
      const app = globalThis.__kvzAuditApp;
      await app.startLevel('level-1');
      const engine = app.engine;
      engine.state.nextSpawnIndex = engine.state.spawnQueue.length;
      for (const enemy of engine.state.enemies) engine.defeatEnemy(enemy, 'browser-audit');
      engine.evaluateOutcome();
      const saved = JSON.parse(localStorage.getItem('cat-garden-defense.save.v1'));
      return {
        title: document.querySelector('#kvz-victory-title')?.textContent?.trim(),
        nextButton: document.querySelector('.kvz-game-modal [data-app-action="next-level"]')?.dataset.levelId,
        completed: saved.completedLevels,
        selected: saved.lastSelectedLevel,
        version: saved.version,
      };
    })()`);
    assert(victoryResult?.title === "Garden Saved!" && victoryResult?.nextButton === "level-2", "Victory UI did not render the correct continuation.");
    assert(victoryResult.version === 2 && victoryResult.selected === "level-2" && victoryResult.completed.includes("level-1"), "Victory progress was not persisted correctly.");

    const defeatAndFallback = await evaluate(cdp, `(async () => {
      const app = globalThis.__kvzAuditApp;
      await app.startLevel('level-1');
      app.engine.placeDefender(2, 2, 'bubble-sprout');
      const sprite = document.querySelector('.kvz-game-defender .kvz-game-unit-sprite');
      sprite?.dispatchEvent(new Event('error'));
      const fallback = document.querySelector('.kvz-game-defender .kvz-game-image-fallback');
      app.engine.state.laneDefenses[1] = false;
      app.engine.spawnEnemy('stray-dog', 1, { waveIndex: 0, final: false });
      app.engine.handleBreach(app.engine.state.enemies.at(-1));
      const websiteControl = document.querySelector('button.game-launch-button[data-kvz-open-game]');
      websiteControl?.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      return {
        fallback: fallback?.getAttribute('aria-label'),
        title: document.querySelector('#kvz-defeat-title')?.textContent?.trim(),
        focusContained: document.querySelector('.kvz-game-modal-backdrop')?.contains(document.activeElement),
      };
    })()`);
    assert(Boolean(defeatAndFallback?.fallback), "Runtime image failure did not create an accessible fallback.");
    assert(defeatAndFallback.title === "Garden Gate Reached", "Defeat UI did not render.");
    assert(defeatAndFallback.focusContained, "Modal focus trap allowed focus to escape into the website.");
    await evaluate(cdp, `(() => {
      const app = globalThis.__kvzAuditApp;
      app.destroy();
      delete globalThis.__kvzAuditApp;
      const state = history.state && typeof history.state === 'object' ? { ...history.state } : {};
      delete state.kvzGameOpen;
      history.replaceState(state, document.title);
    })()`);
    await delay(250);

    if (errors.length) throw new Error(`Browser errors detected:\n- ${[...new Set(errors)].join("\n- ")}`);
    console.log(`Browser smoke passed: landing, menus, all 3 levels, rosters, gameplay, victory, defeat, full screen, touch, seven landscape viewports, orientation, history, BFCache, save/reset, asset fallback, and return flow.`);
    console.log(`Screenshot: ${options.screenshot}`);
    console.log(`Mobile screenshot: ${mobilePath}`);
    console.log(`Level 3 screenshot: ${levelThreePath}`);
  } finally {
    cdp.close();
    await closeTarget(options.cdp, target.id);
    if (!screenshotWritten) console.error("Smoke test ended before a screenshot could be written.");
  }
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
