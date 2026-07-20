const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");
const navLinks = document.querySelectorAll(".site-nav a");
const gameLaunchers = document.querySelectorAll("[data-cvz-open-game]");

let gameModulePromise = null;
let gameApp = null;

function setNavOpen(isOpen) {
  if (!siteNav || !navToggle) return;
  siteNav.classList.toggle("is-open", isOpen);
  navToggle.setAttribute("aria-expanded", String(isOpen));
  navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
}

function loadGameStyles() {
  const existing = document.querySelector("link[data-cvz-game-styles]");
  if (existing instanceof HTMLLinkElement) {
    if (existing.sheet) return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => {
        existing.remove();
        reject(new Error("Game styles could not be loaded"));
      }, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "game/game.css";
    link.dataset.cvzGameStyles = "true";
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => {
      link.remove();
      reject(new Error("Game styles could not be loaded"));
    }, { once: true });
    document.head.append(link);
  });
}

async function getGameApp() {
  if (gameApp) return gameApp;
  if (!gameModulePromise) {
    gameModulePromise = Promise.all([loadGameStyles(), import("./game/game-app.js")]);
  }

  const [, module] = await gameModulePromise;
  gameApp = module.mountGame();
  return gameApp;
}

function showGameLoadError() {
  const banner = document.createElement("div");
  banner.className = "game-load-error";
  banner.setAttribute("role", "alert");
  banner.textContent = "The game could not be opened. Please refresh and try again";
  document.body.append(banner);
  window.setTimeout(() => banner.remove(), 5000);
}

navToggle?.addEventListener("click", () => {
  setNavOpen(!siteNav?.classList.contains("is-open"));
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => setNavOpen(false));
});

gameLaunchers.forEach((launcher) => {
  launcher.addEventListener("click", async (event) => {
    event.preventDefault();
    setNavOpen(false);
    launcher.setAttribute("aria-busy", "true");
    try {
      const app = await getGameApp();
      await app.open(launcher);
    } catch (error) {
      console.error(error);
      gameModulePromise = null;
      showGameLoadError();
    } finally {
      launcher.removeAttribute("aria-busy");
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !gameApp?.isOpen()) {
    setNavOpen(false);
  }
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  gameApp?.destroy();
  gameApp = null;
  gameModulePromise = null;
});
