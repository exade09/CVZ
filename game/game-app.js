// @ts-check

import { DEFENDERS } from "./config/defenders.js";
import { ENEMIES } from "./config/enemies.js";
import { LEVELS, LEVEL_BY_ID } from "./levels/levels.js";
import { AudioManager } from "./audio/audio-manager.js";
import { preloadForLevel, preloadImages } from "./assets/asset-loader.js";
import { GameEngine } from "./core/engine.js";
import { GameRenderer } from "./rendering/game-renderer.js";
import {
  catCollectionScreen,
  creditsScreen,
  dogEncyclopediaScreen,
  howToPlayScreen,
  levelSelectScreen,
  menuScreen,
  settingsScreen,
} from "./ui/screens.js";
import {
  loadSave,
  resetSave,
  saveSave,
} from "./storage/save-store.js";

const HISTORY_STATE_KEY = "cvzGameOpen";

const MENU_ASSETS = [
  new URL("../cvz-brand-hero.jpg", import.meta.url).href,
  new URL("../cvz-fon.png", import.meta.url).href,
  ...DEFENDERS.slice(0, 3).map((definition) => definition.assets.card),
];

/** @param {unknown} candidate */
function isUsableFocusTarget(candidate) {
  if (!(candidate instanceof HTMLElement) || candidate.hidden || candidate.tabIndex < 0) return false;
  if (candidate.closest("[hidden], [inert]")) return false;
  const style = getComputedStyle(candidate);
  return style.display !== "none" && style.visibility !== "hidden" && candidate.getClientRects().length > 0;
}

export class GardenGameApp {
  constructor() {
    this.save = loadSave();
    this.audio = new AudioManager(this.save.settings);
    this.engine = null;
    this.renderer = null;
    this.opened = false;
    this.loaded = false;
    this.loadingPromise = null;
    this.openToken = 0;
    this.levelLoadToken = 0;
    this.activeScreen = "menu";
    this.previousFocus = null;
    this.modalReturnFocus = null;
    this.orientationPaused = false;
    this.historyEntryActive = false;
    this.storageWarningShown = false;
    this.assetWarningShown = false;
    this.uiTimers = new Set();
    this.toastTimers = new Set();
    this.boundRootClick = (event) => this.handleRootClick(event);
    this.boundRootInput = (event) => this.handleSettingInput(event);
    this.boundDocumentKeydown = (event) => this.handleKeydown(event);
    this.boundVisibility = () => this.handleVisibilityChange();
    this.boundOrientation = () => this.syncOrientationState();
    this.boundFullscreen = () => this.syncFullscreenButton();
    this.boundPopState = (event) => this.handlePopState(event);
    this.boundImageError = (event) => this.handleImageError(event);
    this.createRoot();
    this.applyComfortSettings();
  }

  createRoot() {
    this.root = document.createElement("div");
    this.root.id = "cvz-game-root";
    this.root.className = "cvz-game-overlay";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "CVZ Cat Vs Zomb game");
    this.root.innerHTML = `
      <div class="cvz-game-frame">
        <header class="cvz-game-topbar">
          <div class="cvz-game-brand-mark">
            <button class="cvz-game-icon-button" type="button" data-app-action="back" aria-label="Back to main menu" hidden>&larr;</button>
            <span>CVZ</span>
          </div>
          <strong data-screen-title>Garden Gate</strong>
          <div class="cvz-game-hud-status">
            <button class="cvz-game-icon-button" type="button" data-app-action="fullscreen" aria-label="Enter full screen" title="Full screen">&#x26F6;</button>
            <button class="cvz-game-icon-button" type="button" data-app-action="close" aria-label="Return to website" title="Return to website">&#x2715;</button>
          </div>
        </header>
        <main class="cvz-game-screen" tabindex="-1"></main>
        <div class="cvz-game-toast-stack" aria-live="polite" aria-atomic="false"></div>
        <div class="cvz-game-modal-backdrop" hidden></div>
        <div class="cvz-game-victory-confetti" aria-hidden="true"></div>
      </div>`;
    document.body.append(this.root);
    this.screen = /** @type {HTMLElement} */ (this.root.querySelector(".cvz-game-screen"));
    this.topbar = /** @type {HTMLElement} */ (this.root.querySelector(".cvz-game-topbar"));
    this.screenTitle = /** @type {HTMLElement} */ (this.root.querySelector("[data-screen-title]"));
    this.backButton = /** @type {HTMLButtonElement} */ (this.root.querySelector("[data-app-action='back']"));
    this.fullscreenButton = /** @type {HTMLButtonElement} */ (this.root.querySelector("[data-app-action='fullscreen']"));
    this.modalBackdrop = /** @type {HTMLElement} */ (this.root.querySelector(".cvz-game-modal-backdrop"));
    this.toastStack = /** @type {HTMLElement} */ (this.root.querySelector(".cvz-game-toast-stack"));
    this.confetti = /** @type {HTMLElement} */ (this.root.querySelector(".cvz-game-victory-confetti"));
    this.root.addEventListener("click", this.boundRootClick);
    this.root.addEventListener("input", this.boundRootInput);
    this.root.addEventListener("error", this.boundImageError, true);
    document.addEventListener("keydown", this.boundDocumentKeydown);
    document.addEventListener("visibilitychange", this.boundVisibility);
    document.addEventListener("fullscreenchange", this.boundFullscreen);
    window.addEventListener("resize", this.boundOrientation);
    window.addEventListener("orientationchange", this.boundOrientation);
    window.addEventListener("popstate", this.boundPopState);
  }

  /** @param {Element | null} trigger */
  async open(trigger = null) {
    if (this.opened) return;
    const openToken = ++this.openToken;
    this.opened = true;
    this.previousFocus = trigger instanceof HTMLElement ? trigger : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    document.body.classList.add("cvz-game-open");
    this.ensureHistoryEntry();

    if (!this.loaded) {
      this.showLoading("Opening the garden");
      if (!this.loadingPromise) {
        this.loadingPromise = preloadImages(MENU_ASSETS, (progress) => this.updateLoading(progress, "Preparing painted garden panels"));
      }
      const result = await this.loadingPromise;
      if (!this.opened || openToken !== this.openToken) return;
      this.loaded = true;
      if (result.failed > 0) this.showToast("Some optional artwork could not be loaded. Gameplay can continue", "warning");
    }

    if (this.engine && this.activeScreen === "gameplay" && this.engine.getState().status === "paused") {
      this.root.classList.add("is-playing", "is-paused");
      this.showPauseModal(this.engine.getState().pauseReason === "hidden" ? "The browser tab became inactive" : "The game is paused");
      this.renderer?.render(this.engine.getState());
      void this.audio.suspend();
    } else {
      this.showMenu();
    }
    this.syncOrientationState();
    this.scheduleUi(() => {
      if (this.opened && openToken === this.openToken) this.focusFirstControl();
    }, 0);
  }

  /** @param {boolean} [fromHistory] */
  close(fromHistory = false) {
    if (!this.opened) return;
    this.openToken += 1;
    if (this.engine?.isRunning()) {
      this.engine.pause("closed");
      this.root.classList.add("is-paused");
    }
    this.hideModal(false);
    this.removeFinalWarning();
    this.clearUiTimers();
    this.clearToasts();
    this.clearConfetti();
    this.root.hidden = true;
    this.root.classList.remove("is-closing");
    document.body.classList.remove("cvz-game-open");
    this.audio.suspend();
    this.opened = false;
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
    const focusTarget = this.previousFocus?.isConnected && isUsableFocusTarget(this.previousFocus)
      ? this.previousFocus
      : [...document.querySelectorAll("[data-cvz-open-game], .nav-toggle")].find(isUsableFocusTarget);
    if (focusTarget instanceof HTMLElement) focusTarget.focus({ preventScroll: true });
    const shouldRewindHistory = !fromHistory && this.historyEntryActive && history.state?.[HISTORY_STATE_KEY] === true;
    this.historyEntryActive = false;
    if (shouldRewindHistory) history.back();
  }

  isOpen() {
    return this.opened;
  }

  showLoading(message) {
    this.destroyRenderer(false);
    this.activeScreen = "loading";
    this.root.classList.remove("is-playing", "is-paused");
    this.backButton.hidden = true;
    this.screenTitle.textContent = "Loading";
    this.screen.innerHTML = `
      <section class="cvz-game-loading" aria-labelledby="cvz-loading-title">
        <div class="cvz-game-panel">
          <h1 class="cvz-game-title" id="cvz-loading-title">Garden Waking Up</h1>
          <p class="cvz-game-subtitle" data-loading-message>${message}</p>
          <div class="cvz-game-loading-track" role="progressbar" aria-label="Asset loading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
          <strong data-loading-percent>0%</strong>
        </div>
      </section>`;
    this.updateLoading(0, message);
  }

  /** @param {number} progress @param {string} message */
  updateLoading(progress, message) {
    const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    const track = /** @type {HTMLElement | null} */ (this.screen.querySelector(".cvz-game-loading-track"));
    const fill = /** @type {HTMLElement | null} */ (track?.querySelector("span") ?? null);
    const label = /** @type {HTMLElement | null} */ (this.screen.querySelector("[data-loading-percent]"));
    const copy = /** @type {HTMLElement | null} */ (this.screen.querySelector("[data-loading-message]"));
    track?.style.setProperty("--progress", `${percent}%`);
    fill?.style.setProperty("--progress", `${percent}%`);
    track?.setAttribute("aria-valuenow", String(percent));
    if (label) label.textContent = `${percent}%`;
    if (copy) copy.textContent = message;
  }

  showMenu() {
    this.destroyLevel();
    this.activeScreen = "menu";
    this.root.classList.remove("is-playing", "is-paused");
    this.hideModal();
    this.clearConfetti();
    this.backButton.hidden = true;
    this.screenTitle.textContent = "Main Menu";
    this.screen.innerHTML = menuScreen(Boolean(this.save.campaignProgress.hasStarted));
    this.activateAudio("menu");
    this.focusScreen();
  }

  showLevels() {
    this.destroyLevel();
    this.showSubScreen("levels", "Level Select", levelSelectScreen(LEVELS, this.save));
  }

  showCats() {
    this.showSubScreen("cats", "Cat Collection", catCollectionScreen(DEFENDERS, this.save));
  }

  showDogs() {
    this.showSubScreen("dogs", "Dog Encyclopedia", dogEncyclopediaScreen(ENEMIES, this.save));
  }

  showHowTo() {
    this.showSubScreen("how-to", "How to Play", howToPlayScreen());
  }

  showSettings() {
    this.showSubScreen("settings", "Settings", settingsScreen(this.save.settings));
  }

  showCredits() {
    this.showSubScreen("credits", "Credits", creditsScreen());
  }

  /** @param {string} name @param {string} title @param {string} markup */
  showSubScreen(name, title, markup) {
    this.activeScreen = name;
    this.root.classList.remove("is-playing", "is-paused");
    this.hideModal();
    this.backButton.hidden = false;
    this.screenTitle.textContent = title;
    this.screen.innerHTML = markup;
    this.screen.scrollTop = 0;
    this.activateAudio("menu");
    this.focusScreen();
  }

  /** @param {string} levelId */
  async startLevel(levelId) {
    const level = LEVEL_BY_ID[levelId];
    if (!level || level.number > this.save.campaignProgress.highestUnlockedLevel) {
      this.showToast("Complete the previous garden before entering this one", "warning");
      return;
    }

    this.hideModal();
    this.clearConfetti();
    this.destroyLevel();
    const loadToken = this.levelLoadToken;
    this.save.lastSelectedLevel = level.id;
    this.save.campaignProgress.hasStarted = true;
    this.save.unlockedCats = [...new Set([...this.save.unlockedCats, ...level.availableDefenders])];
    this.persistSave();
    this.showLoading(`Preparing ${level.name}`);
    const result = await preloadForLevel(DEFENDERS, ENEMIES, level, (progress) => {
      this.updateLoading(progress, `Loading cats and dogs for ${level.name}`);
    });
    if (!this.opened || loadToken !== this.levelLoadToken) return;
    if (document.hidden) {
      this.showMenu();
      return;
    }
    if (result.failed > 0) this.showToast("A character image could not be loaded. The level will still run", "warning");

    this.activeScreen = "gameplay";
    this.root.classList.add("is-playing");
    this.root.classList.remove("is-paused");
    this.backButton.hidden = true;
    this.screenTitle.textContent = level.name;
    this.screen.scrollTo({ top: 0, left: 0 });
    this.screen.replaceChildren();
    this.engine = new GameEngine({
      level,
      onFrame: (state) => this.renderer?.render(state),
      onEvent: (event) => this.handleGameEvent(event),
    });
    this.renderer = new GameRenderer({
      container: this.screen,
      engine: this.engine,
      onPause: () => this.pauseGame("manual"),
      onSpeed: (speed) => this.engine?.setSpeed(speed),
    });
    this.renderer.render(this.engine.getState());
    this.activateAudio("game");
    this.engine.start();
    this.syncOrientationState();
    if (!this.isPortraitGameplay()) this.focusScreen();
  }

  /** @param {string} reason */
  pauseGame(reason) {
    if (!this.engine?.isRunning() || this.activeScreen !== "gameplay") return;
    this.engine.pause(reason);
    this.root.classList.add("is-paused");
    this.showPauseModal(reason === "hidden" ? "The browser tab became inactive" : "The garden is waiting for you");
    void this.audio.suspend();
  }

  showPauseModal(message) {
    this.showModal(`
      <div class="cvz-game-modal paused" role="dialog" aria-modal="true" aria-labelledby="cvz-pause-title">
        <h2 id="cvz-pause-title">Game Paused</h2>
        <p>${message}</p>
        <button class="cvz-game-button primary" type="button" data-app-action="resume-game">Resume</button>
        <button class="cvz-game-button secondary" type="button" data-app-action="restart-level">Restart Level</button>
        <button class="cvz-game-button" type="button" data-app-action="level-select">Level Select</button>
        <button class="cvz-game-button back" type="button" data-app-action="quit-game">Main Menu</button>
        <button class="cvz-game-button back" type="button" data-app-action="return-site">Return to Website</button>
      </div>`);
  }

  resumeGame() {
    if (!this.engine || this.engine.getState().status !== "paused") return;
    if (this.isPortraitGameplay()) {
      this.orientationPaused = true;
      this.engine.pause("orientation");
      this.hideModal(false);
      this.syncOrientationState();
      return;
    }
    this.orientationPaused = false;
    this.hideModal();
    this.root.classList.remove("is-paused");
    void this.audio.resume();
    this.audio.playMusic("game");
    this.engine.resume();
    this.screen.focus({ preventScroll: true });
  }

  /** @param {{type: string, detail: any}} event */
  handleGameEvent(event) {
    this.renderer?.handleEvent(event);
    switch (event.type) {
      case "card-selected":
        this.audio.playSfx("select");
        break;
      case "defender-placed":
        this.audio.playSfx("place");
        if (this.engine?.getState().stats.placed === 1) this.showToast("Great placement! Watch that lane for approaching dogs", "success");
        break;
      case "invalid-placement":
        this.audio.playSfx("button");
        this.showToast(this.placementMessage(event.detail.reason), "warning", 1700);
        break;
      case "energy-collected":
        this.audio.playSfx("energy");
        break;
      case "defender-fired":
        this.audio.playSfx("projectile");
        break;
      case "projectile-impact":
        this.audio.playSfx("hit");
        break;
      case "armor-broken":
        this.audio.playSfx("armorbreak");
        this.showToast(`${event.detail.enemy.definition.name}'s armor broke!`, "success", 1900);
        break;
      case "shield-broken":
        this.audio.playSfx("shieldbreak");
        this.showToast(`${event.detail.enemy.definition.name}'s shield broke!`, "success", 1900);
        break;
      case "root-pulse":
        this.audio.playSfx("energy");
        break;
      case "burst-activated":
        this.audio.playSfx("wavewarning");
        this.shakeFrame();
        break;
      case "tutorial":
        this.showToast(event.detail.message, "success", 4400);
        break;
      case "final-wave-warning":
        this.audio.playSfx("wavewarning");
        this.showFinalWarning();
        break;
      case "lane-defense-activated":
        this.audio.playSfx("wavewarning");
        this.shakeFrame();
        this.showToast(`Lane ${event.detail.lane + 1} Yarn Sweeper activated. That lane is now unguarded`, "warning", 3800);
        break;
      case "enemy-spawned":
        this.recordEncounter(event.detail.enemy.definitionId);
        break;
      case "victory":
        this.completeLevel(event.detail.levelId);
        break;
      case "defeat":
        this.showDefeat(event.detail.lane);
        break;
      default:
        break;
    }
  }

  /** @param {string} reason @returns {string} */
  placementMessage(reason) {
    const messages = {
      "no-selection": "Select a cat card first",
      "insufficient-energy": "Collect more Paw Energy for that cat",
      cooldown: "That cat card is still cooling down",
      occupied: "One cat already protects that garden cell",
      "out-of-bounds": "Choose a visible garden cell",
      paused: "Resume the game before placing a cat",
    };
    return messages[reason] ?? "That cat cannot be placed there right now";
  }

  /** @param {string} enemyId */
  recordEncounter(enemyId) {
    if (this.save.encounteredDogs.includes(enemyId)) return;
    this.save.encounteredDogs.push(enemyId);
    this.persistSave();
  }

  /** @param {string} levelId */
  completeLevel(levelId) {
    const level = LEVEL_BY_ID[levelId];
    if (!level) return;
    const next = LEVELS[level.number];
    if (!this.save.completedLevels.includes(levelId)) this.save.completedLevels.push(levelId);
    this.save.unlockedCats = [...new Set([...this.save.unlockedCats, ...level.unlocks])];
    this.save.campaignProgress.lastCompletedLevel = levelId;
    this.save.campaignProgress.hasStarted = true;
    this.save.campaignProgress.highestUnlockedLevel = Math.min(LEVELS.length, Math.max(this.save.campaignProgress.highestUnlockedLevel, level.number + 1));
    this.save.lastSelectedLevel = next?.id ?? level.id;
    const persisted = this.persistSave();
    this.audio.playSfx("victory");
    this.audio.stopMusic();
    this.root.classList.add("is-paused");
    this.createConfetti();
    this.showModal(`
      <div class="cvz-game-modal" role="dialog" aria-modal="true" aria-labelledby="cvz-victory-title">
        <h2 id="cvz-victory-title">Garden Saved!</h2>
        <p>${level.name} is peaceful again. ${persisted ? "Your collection and campaign progress were saved on this device" : "Progress is available for this session, but browser storage is unavailable"}</p>
        ${next ? `<button class="cvz-game-button primary" type="button" data-app-action="next-level" data-level-id="${next.id}">Next Level</button>` : '<button class="cvz-game-button primary" type="button" data-app-action="level-select">Campaign Complete</button>'}
        <button class="cvz-game-button secondary" type="button" data-app-action="restart-level">Play Again</button>
        <button class="cvz-game-button back" type="button" data-app-action="quit-game">Main Menu</button>
        <button class="cvz-game-button back" type="button" data-app-action="return-site">Return to Website</button>
      </div>`);
  }

  /** @param {number} lane */
  showDefeat(lane) {
    this.audio.playSfx("defeat");
    this.audio.stopMusic();
    this.root.classList.add("is-paused");
    this.showModal(`
      <div class="cvz-game-modal" role="dialog" aria-modal="true" aria-labelledby="cvz-defeat-title">
        <h2 id="cvz-defeat-title">Garden Gate Reached</h2>
        <p>A zombie dog slipped through Lane ${lane + 1}. Shift your blockers and try a new cat combination</p>
        <button class="cvz-game-button primary" type="button" data-app-action="restart-level">Restart Level</button>
        <button class="cvz-game-button secondary" type="button" data-app-action="level-select">Level Select</button>
        <button class="cvz-game-button back" type="button" data-app-action="quit-game">Main Menu</button>
        <button class="cvz-game-button back" type="button" data-app-action="return-site">Return to Website</button>
      </div>`);
  }

  showFinalWarning() {
    this.removeFinalWarning();
    const warning = document.createElement("div");
    warning.className = "cvz-game-final-warning";
    warning.setAttribute("role", "status");
    warning.textContent = "Final Wave Approaching!";
    this.root.querySelector(".cvz-game-frame")?.append(warning);
    warning.addEventListener("animationend", () => warning.remove(), { once: true });
  }

  removeFinalWarning() {
    this.root.querySelector(".cvz-game-final-warning")?.remove();
  }

  /** @param {string} markup */
  showModal(markup) {
    if (this.modalBackdrop.hidden) {
      this.modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.modalBackdrop.innerHTML = markup;
    this.modalBackdrop.hidden = false;
    this.screen.inert = true;
    this.screen.setAttribute("aria-hidden", "true");
    this.topbar.inert = true;
    this.topbar.setAttribute("aria-hidden", "true");
    this.scheduleUi(() => {
      const control = this.modalBackdrop.querySelector("[data-modal-autofocus], button, [href], input");
      if (control instanceof HTMLElement) control.focus({ preventScroll: true });
    }, 0);
  }

  /** @param {boolean} [restoreFocus] */
  hideModal(restoreFocus = false) {
    const returnFocus = this.modalReturnFocus;
    this.modalBackdrop.hidden = true;
    this.modalBackdrop.replaceChildren();
    this.screen.inert = false;
    this.screen.removeAttribute("aria-hidden");
    this.topbar.inert = false;
    this.topbar.removeAttribute("aria-hidden");
    this.modalReturnFocus = null;
    if (restoreFocus) {
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) {
        returnFocus.focus({ preventScroll: true });
      } else {
        this.focusScreen();
      }
    }
  }

  /** @param {string} message @param {'success' | 'warning' | 'error'} [type] @param {number} [duration] */
  showToast(message, type = "success", duration = 3000) {
    if (!this.opened) return;
    const toast = document.createElement("div");
    toast.className = `cvz-game-toast ${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.textContent = message;
    this.toastStack.append(toast);
    const timer = window.setTimeout(() => {
      toast.remove();
      this.toastTimers.delete(timer);
    }, duration);
    this.toastTimers.add(timer);
  }

  createConfetti() {
    this.clearConfetti();
    const colors = ["#ff82ad", "#ffe15d", "#a8ec36", "#5ecce2"];
    for (let index = 0; index < 28; index += 1) {
      const piece = document.createElement("i");
      piece.style.setProperty("--x", `${(index * 37) % 100}%`);
      piece.style.setProperty("--color", colors[index % colors.length]);
      piece.style.setProperty("--delay", `${(index % 9) * -0.23}s`);
      piece.style.setProperty("--duration", `${2.4 + (index % 5) * 0.2}s`);
      piece.style.setProperty("--drift", `${(index % 2 ? 1 : -1) * (12 + (index % 4) * 8)}px`);
      this.confetti.append(piece);
    }
  }

  clearConfetti() {
    this.confetti.replaceChildren();
  }

  clearToasts() {
    for (const timer of this.toastTimers) window.clearTimeout(timer);
    this.toastTimers.clear();
    this.toastStack.replaceChildren();
  }

  /** @param {() => void} callback @param {number} delayMs */
  scheduleUi(callback, delayMs) {
    const timer = window.setTimeout(() => {
      this.uiTimers.delete(timer);
      callback();
    }, delayMs);
    this.uiTimers.add(timer);
    return timer;
  }

  clearUiTimers() {
    for (const timer of this.uiTimers) window.clearTimeout(timer);
    this.uiTimers.clear();
  }

  /** @param {MouseEvent} event */
  handleRootClick(event) {
    const target = event.target instanceof Element ? event.target.closest("[data-app-action], [data-action]") : null;
    if (!target) {
      this.audio.unlock();
      return;
    }
    this.audio.unlock();
    this.audio.playSfx("button");
    const action = target.getAttribute("data-app-action") ?? target.getAttribute("data-action");
    switch (action) {
      case "close":
      case "return-site":
        this.close();
        break;
      case "fullscreen":
        this.toggleFullscreen();
        break;
      case "back":
        this.showMenu();
        break;
      case "play":
        this.startLevel(this.nextCampaignLevelId());
        break;
      case "continue":
        this.startLevel(this.save.lastSelectedLevel);
        break;
      case "levels":
      case "level-select":
        this.showLevels();
        break;
      case "cats":
        this.showCats();
        break;
      case "dogs":
        this.showDogs();
        break;
      case "how-to":
        this.showHowTo();
        break;
      case "settings":
        this.showSettings();
        break;
      case "credits":
        this.showCredits();
        break;
      case "start-level":
      case "next-level":
        this.startLevel(target.getAttribute("data-level-id") ?? "level-1");
        break;
      case "resume-game":
        this.resumeGame();
        break;
      case "restart-level":
        this.startLevel(this.engine?.level.id ?? this.save.lastSelectedLevel);
        break;
      case "quit-game":
        this.showMenu();
        break;
      case "reset-progress":
        this.confirmReset();
        break;
      case "confirm-reset":
        this.performReset();
        break;
      case "cancel-modal":
        this.hideModal(true);
        break;
      default:
        break;
    }
  }

  confirmReset() {
    this.showModal(`
      <div class="cvz-game-modal" role="alertdialog" aria-modal="true" aria-labelledby="cvz-reset-title">
        <h2 id="cvz-reset-title">Reset Local Progress?</h2>
        <p>This removes completed levels, discovered dogs, unlocks, and saved settings from this browser</p>
        <button class="cvz-game-button danger" type="button" data-app-action="confirm-reset">Reset Everything</button>
        <button class="cvz-game-button secondary" type="button" data-app-action="cancel-modal" data-modal-autofocus>Keep Progress</button>
      </div>`);
  }

  performReset() {
    this.save = resetSave();
    this.storageWarningShown = false;
    this.audio.setSettings(this.save.settings);
    this.applyComfortSettings();
    this.hideModal();
    this.showSettings();
    this.showToast("Local campaign progress was reset", "success");
  }

  /** @param {Event} event */
  handleSettingInput(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.setting) return;
    const key = input.dataset.setting;
    if (input.type === "checkbox") {
      this.save.settings[key] = input.checked;
    } else {
      this.save.settings[key] = Number(input.value);
      const output = input.parentElement?.querySelector("output");
      if (output) output.textContent = `${Math.round(Number(input.value) * 100)}%`;
    }
    this.persistSave();
    this.audio.setSettings(this.save.settings);
    this.applyComfortSettings();
  }

  applyComfortSettings() {
    this.root.classList.toggle("reduce-motion", Boolean(this.save.settings.reducedMotion));
    this.root.classList.toggle("screen-shake-enabled", Boolean(this.save.settings.screenShake));
  }

  shakeFrame() {
    if (!this.save.settings.screenShake || this.save.settings.reducedMotion) return;
    const frame = this.root.querySelector(".cvz-game-frame");
    if (!(frame instanceof HTMLElement)) return;
    frame.classList.remove("is-shaking");
    void frame.offsetWidth;
    frame.classList.add("is-shaking");
    const finish = (event) => {
      if (event.target !== frame || event.animationName !== "cvz-screen-shake") return;
      frame.classList.remove("is-shaking");
      frame.removeEventListener("animationend", finish);
    };
    frame.addEventListener("animationend", finish);
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement === this.root) await document.exitFullscreen();
      else await this.root.requestFullscreen();
    } catch {
      this.showToast("Full screen is not available in this browser", "warning");
    } finally {
      this.syncFullscreenButton();
    }
  }

  syncFullscreenButton() {
    const active = document.fullscreenElement === this.root;
    this.fullscreenButton.setAttribute("aria-label", active ? "Exit full screen" : "Enter full screen");
    this.fullscreenButton.title = active ? "Exit full screen" : "Full screen";
  }

  /** @param {KeyboardEvent} event */
  handleKeydown(event) {
    if (!this.opened) return;
    if (event.key === "Tab") {
      this.trapFocus(event);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      const gameStatus = this.engine?.getState().status;
      if (!this.modalBackdrop.hidden && gameStatus === "paused") this.resumeGame();
      else if (!this.modalBackdrop.hidden && (gameStatus === "victory" || gameStatus === "defeat")) this.showMenu();
      else if (!this.modalBackdrop.hidden) this.hideModal(true);
      else if (this.activeScreen === "gameplay") this.pauseGame("manual");
      else if (this.activeScreen !== "menu") this.showMenu();
      else this.close();
      return;
    }
    const interactiveTarget = event.target instanceof Element
      ? event.target.closest("button, a[href], input, select, textarea, [contenteditable='true']")
      : null;
    if (event.code === "Space" && !event.repeat && this.activeScreen === "gameplay" && !interactiveTarget) {
      event.preventDefault();
      if (this.engine?.isRunning()) this.pauseGame("manual");
      else if (this.engine?.getState().status === "paused") this.resumeGame();
      return;
    }
    if (
      this.activeScreen === "gameplay" &&
      this.engine?.isRunning() &&
      !event.repeat &&
      this.modalBackdrop.hidden &&
      !this.root.classList.contains("orientation-blocked")
    ) {
      this.renderer?.handleKey(event);
    }
  }

  handleVisibilityChange() {
    if (!this.opened) return;
    if (document.hidden) {
      if (this.engine?.isRunning()) this.pauseGame("hidden");
      else void this.audio.suspend();
      return;
    }
    this.syncOrientationState();
    if (this.activeScreen !== "gameplay") this.activateAudio("menu");
  }

  isPortraitGameplay() {
    return this.opened && this.activeScreen === "gameplay" && window.matchMedia("(orientation: portrait) and (max-width: 760px)").matches;
  }

  syncOrientationState() {
    const blocked = this.isPortraitGameplay();
    const hint = this.root.querySelector(".cvz-game-orientation-hint");
    hint?.setAttribute("aria-hidden", String(!blocked));
    this.root.classList.toggle("orientation-blocked", blocked);
    for (const selector of [".cvz-game-hud", ".cvz-game-card-tray", ".cvz-game-battlefield-wrap"]) {
      const section = this.root.querySelector(selector);
      if (!(section instanceof HTMLElement)) continue;
      section.inert = blocked;
      if (blocked) section.setAttribute("aria-hidden", "true");
      else section.removeAttribute("aria-hidden");
    }
    if (!this.engine || this.activeScreen !== "gameplay") {
      this.orientationPaused = false;
      return;
    }
    if (blocked && this.engine.isRunning()) {
      this.orientationPaused = true;
      this.engine.pause("orientation");
      this.root.classList.add("is-paused");
      void this.audio.suspend();
      const panel = hint?.querySelector(".cvz-game-panel");
      if (panel instanceof HTMLElement) panel.focus({ preventScroll: true });
      return;
    }
    if (
      !blocked &&
      this.orientationPaused &&
      !document.hidden &&
      this.engine.getState().status === "paused" &&
      this.engine.getState().pauseReason === "orientation"
    ) {
      this.resumeGame();
    }
  }

  /** @param {KeyboardEvent} event */
  trapFocus(event) {
    const scope = this.modalBackdrop.hidden ? this.root : this.modalBackdrop;
    const controls = [...scope.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter(isUsableFocusTarget);
    if (!controls.length) return;
    const first = /** @type {HTMLElement} */ (controls[0]);
    const last = /** @type {HTMLElement} */ (controls.at(-1));
    if (!scope.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  focusFirstControl() {
    const control = [...this.root.querySelectorAll("button:not([disabled]), [href], input:not([disabled])")]
      .find(isUsableFocusTarget);
    if (control instanceof HTMLElement) control.focus({ preventScroll: true });
    else this.focusScreen();
  }

  focusScreen() {
    this.scheduleUi(() => {
      if (this.opened && !this.screen.inert) this.screen.focus({ preventScroll: true });
    }, 0);
  }

  /** @param {'menu' | 'game'} theme */
  activateAudio(theme) {
    if (!this.opened || document.hidden) {
      void this.audio.suspend();
      return;
    }
    void this.audio.resume();
    this.audio.playMusic(theme);
  }

  persistSave() {
    const saved = saveSave(this.save);
    if (!saved && this.opened && !this.storageWarningShown) {
      this.storageWarningShown = true;
      this.showToast("Browser storage is unavailable. Progress will last only for this session", "warning", 5000);
    }
    return saved;
  }

  ensureHistoryEntry() {
    if (history.state?.[HISTORY_STATE_KEY] === true) {
      this.historyEntryActive = true;
      return;
    }
    try {
      const current = history.state && typeof history.state === "object" ? history.state : {};
      history.pushState({ ...current, [HISTORY_STATE_KEY]: true }, document.title);
      this.historyEntryActive = true;
    } catch {
      this.historyEntryActive = false;
    }
  }

  /** @param {PopStateEvent} event */
  handlePopState(event) {
    const gameEntry = Boolean(event.state && typeof event.state === "object" && event.state[HISTORY_STATE_KEY] === true);
    this.historyEntryActive = gameEntry;
    if (gameEntry && !this.opened) {
      void this.open();
    } else if (!gameEntry && this.opened) {
      this.close(true);
    }
  }

  /** @param {Event} event */
  handleImageError(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.dataset.fallbackApplied === "true") return;
    image.dataset.fallbackApplied = "true";
    image.hidden = true;
    const fallback = document.createElement("span");
    fallback.className = "cvz-game-image-fallback";
    fallback.setAttribute("role", "img");
    fallback.setAttribute("aria-label", image.alt || "Artwork unavailable");
    fallback.textContent = image.alt.toLowerCase().includes("dog") ? "DOG" : "PAW";
    image.insertAdjacentElement("afterend", fallback);
    if (!this.assetWarningShown) {
      this.assetWarningShown = true;
      this.showToast("Some artwork is unavailable, so a readable fallback is being used", "warning", 4200);
    }
  }

  nextCampaignLevelId() {
    return LEVELS.find((level) => !this.save.completedLevels.includes(level.id) && level.number <= this.save.campaignProgress.highestUnlockedLevel)?.id
      ?? this.save.lastSelectedLevel
      ?? "level-1";
  }

  /** @param {boolean} [clearScreen] */
  destroyRenderer(clearScreen = true) {
    this.renderer?.destroy();
    this.renderer = null;
    if (clearScreen) this.screen?.replaceChildren();
  }

  destroyLevel() {
    this.levelLoadToken += 1;
    this.removeFinalWarning();
    this.engine?.destroy();
    this.engine = null;
    this.destroyRenderer(false);
    this.orientationPaused = false;
  }

  destroy() {
    this.openToken += 1;
    this.destroyLevel();
    this.audio.destroy();
    this.clearUiTimers();
    this.clearToasts();
    this.clearConfetti();
    this.root.removeEventListener("click", this.boundRootClick);
    this.root.removeEventListener("input", this.boundRootInput);
    this.root.removeEventListener("error", this.boundImageError, true);
    document.removeEventListener("keydown", this.boundDocumentKeydown);
    document.removeEventListener("visibilitychange", this.boundVisibility);
    document.removeEventListener("fullscreenchange", this.boundFullscreen);
    window.removeEventListener("resize", this.boundOrientation);
    window.removeEventListener("orientationchange", this.boundOrientation);
    window.removeEventListener("popstate", this.boundPopState);
    if (history.state?.[HISTORY_STATE_KEY] === true) {
      try {
        const state = history.state && typeof history.state === "object" ? { ...history.state } : {};
        delete state[HISTORY_STATE_KEY];
        history.replaceState(state, document.title);
      } catch {
        // A restrictive browser may reject history changes during page teardown.
      }
    }
    this.historyEntryActive = false;
    document.body.classList.remove("cvz-game-open");
    this.root.remove();
    this.opened = false;
  }
}

/**
 * Mounts the lazy game shell and returns its public lifecycle API.
 */
export function mountGame() {
  return new GardenGameApp();
}

export default mountGame;
