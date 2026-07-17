/* Rift Recap frontend: profile + match history rendering, theme toggle,
 * background music with autoplay fallback. */

const state = { ddragonVersion: "15.13.1" };

/* ---------------- Theme ---------------- */

const themeToggle = document.getElementById("theme-toggle");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("riftrecap-theme", theme);
}

(function initTheme() {
  const saved = localStorage.getItem("riftrecap-theme");
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(saved || (prefersLight ? "light" : "dark"));
})();

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === "light" ? "dark" : "light");
});

/* ---------------- Background music ----------------
 * Source priority:
 *   1. /static/audio/summoners-rift.mp3  (drop the official theme here)
 *   2. MUSIC_URL from server config       (any streamable audio URL)
 *   3. bundled ambient loop               (always available)
 * Autoplay with sound is blocked by most browsers until the user interacts
 * with the page, so we try immediately and retry on the first interaction —
 * no visible button needed. */

const music = document.getElementById("bg-music");
music.volume = 0.35;

function tryPlayMusic() {
  music.play().then(() => {
    ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
      document.removeEventListener(ev, tryPlayMusic)
    );
  }).catch(() => { /* still blocked; a later interaction will retry */ });
}

async function initMusic(configMusicUrl) {
  const sources = [];
  try {
    const head = await fetch("/static/audio/summoners-rift.mp3", { method: "HEAD" });
    if (head.ok) sources.push("/static/audio/summoners-rift.mp3");
  } catch (_) { /* not provided */ }
  if (configMusicUrl) sources.push(configMusicUrl);
  sources.push("/static/audio/rift-ambience.wav");

  let idx = 0;
  const loadNext = () => {
    if (idx >= sources.length) return;
    music.src = sources[idx++];
    tryPlayMusic();
  };
  music.addEventListener("error", loadNext);
  ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, tryPlayMusic)
  );
  loadNext();
}

/* ---------------- Data loading ---------------- */

const $ = (id) => document.getElementById(id);

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtWhen(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const hours = Math.floor(diff / 36e5);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function champImgUrl(champ) {
  return `https://ddragon.leagueoflegends.com/cdn/${state.ddragonVersion}/img/champion/${champ}.png`;
}

function profileIconUrl(iconId) {
  return `https://ddragon.leagueoflegends.com/cdn/${state.ddragonVersion}/img/profileicon/${iconId}.png`;
}

/* Neutral placeholder shown if the Data Dragon CDN is unreachable */
const FALLBACK_IMG = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="12" fill="#5b6478"/>' +
  '<path d="M32 14l5 12 13 2-9 9 2 13-11-6-11 6 2-13-9-9 13-2z" fill="#e8ecf4" opacity="0.85"/></svg>');

function withImgFallback(img) {
  img.addEventListener("error", () => {
    if (img.src !== FALLBACK_IMG) img.src = FALLBACK_IMG;
  });
}

/* Insert spaces into ddragon champion keys for display: "LeeSin" -> "Lee Sin" */
function champDisplayName(champ) {
  return champ.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function showError(msg) {
  const box = $("error-box");
  box.textContent = msg;
  box.hidden = false;
}

function renderProfile(p) {
  if (p.error) return showError(p.error);
  withImgFallback($("summoner-icon"));
  $("summoner-icon").src = profileIconUrl(p.profileIconId);
  $("summoner-name").innerHTML =
    `${escapeHtml(p.gameName)} <span class="tag">#${escapeHtml(p.tagLine)}</span>`;
  const level = $("summoner-level");
  level.textContent = `Level ${p.level}`;
  level.hidden = false;
  if (p.demo) $("demo-note").hidden = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function matchCard(m) {
  const card = document.createElement("article");
  card.className = `match-card ${m.win ? "win" : "loss"}`;
  card.setAttribute("role", "listitem");

  const teamClass = (t) => (t === "Blue" ? "team-blue" : t === "Red" ? "team-red" : "");
  card.innerHTML = `
    <button class="match-row" aria-expanded="false">
      <img class="champ-img" src="${champImgUrl(m.champion)}" alt="${escapeHtml(m.champion)}" loading="lazy">
      <div class="match-main">
        <div class="champ-name">${escapeHtml(champDisplayName(m.champion))}</div>
        <div class="match-sub">${escapeHtml(m.mode)} · ${fmtWhen(m.endedAt)}</div>
      </div>
      <span class="duration">${fmtDuration(m.durationSec)}</span>
      <span class="result-pill ${m.win ? "win" : "loss"}">${m.win ? "VICTORY" : "DEFEAT"}</span>
      <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="match-details">
      <div class="details-inner">
        <div class="details-grid">
          <div class="stat"><span class="stat-label">KDA</span>
            <span class="stat-value"><span class="k">${m.kills}</span> / <span class="d">${m.deaths}</span> / <span class="a">${m.assists}</span></span></div>
          <div class="stat"><span class="stat-label">KDA Ratio</span>
            <span class="stat-value">${m.kda.toFixed(2)}</span></div>
          <div class="stat"><span class="stat-label">Mode</span>
            <span class="stat-value">${escapeHtml(m.mode)}</span></div>
          <div class="stat"><span class="stat-label">Duration</span>
            <span class="stat-value">${fmtDuration(m.durationSec)}</span></div>
          <div class="stat"><span class="stat-label">Winning Team</span>
            <span class="stat-value ${teamClass(m.winningTeam)}">${escapeHtml(m.winningTeam)} side</span></div>
          <div class="stat"><span class="stat-label">Your Team</span>
            <span class="stat-value ${teamClass(m.myTeam)}">${escapeHtml(m.myTeam)} side</span></div>
          <div class="stat"><span class="stat-label">CS</span>
            <span class="stat-value">${m.cs}</span></div>
          <div class="stat"><span class="stat-label">Gold</span>
            <span class="stat-value">${m.gold.toLocaleString()}</span></div>
        </div>
      </div>
    </div>`;

  withImgFallback(card.querySelector(".champ-img"));
  const row = card.querySelector(".match-row");
  row.addEventListener("click", () => {
    const open = card.classList.toggle("open");
    row.setAttribute("aria-expanded", String(open));
  });
  return card;
}

function renderMatches(matches) {
  const list = $("match-list");
  list.innerHTML = "";
  if (matches.error) return showError(matches.error);
  if (!matches.length) {
    list.innerHTML = '<p class="match-sub">No recent games found.</p>';
    return;
  }
  matches.forEach((m) => list.appendChild(matchCard(m)));
}

async function init() {
  try {
    const config = await (await fetch("/api/config")).json();
    state.ddragonVersion = config.ddragonVersion || state.ddragonVersion;
    initMusic(config.musicUrl);

    const [profile, matches] = await Promise.all([
      (await fetch("/api/profile")).json(),
      (await fetch("/api/matches")).json(),
    ]);
    renderProfile(profile);
    renderMatches(matches);
  } catch (err) {
    showError(`Failed to load data: ${err.message}`);
  }
}

init();
