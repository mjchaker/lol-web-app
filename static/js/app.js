/* Rift Recap frontend: profile + match history rendering, theme toggle,
 * background music with autoplay fallback. */

const state = { ddragonVersion: "15.13.1" };

/* ---------------- Theme ---------------- */

const themeToggle = document.getElementById("theme-toggle");

const THEME_KEY = "riftrecap-theme";

function readSavedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (_) { return null; }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* storage unavailable */ }
}

(function initTheme() {
  // The inline script in <head> already set data-theme to avoid a flash;
  // re-derive here in case it was skipped, and persist the choice.
  const saved = readSavedTheme();
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(saved === "light" || saved === "dark" ? saved : (prefersLight ? "light" : "dark"));
})();

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === "light" ? "dark" : "light");
});

/* ---------------- Background music ----------------
 * Source priority:
 *   1. /static/audio/summoners-rift.mp3  (drop the official theme here)
 *   2. MUSIC_URL from server config       (direct audio URL or YouTube link)
 *   3. bundled ambient loop               (always available)
 * Autoplay with sound is blocked by most browsers until the user interacts
 * with the page, so we try immediately and retry on the first interaction —
 * no visible button needed. */

const music = document.getElementById("bg-music");
music.volume = 0.35;

const INTERACTION_EVENTS = ["pointerdown", "keydown", "touchstart"];

function tryPlayMusic() {
  music.play().then(() => {
    INTERACTION_EVENTS.forEach((ev) => document.removeEventListener(ev, tryPlayMusic));
  }).catch(() => { /* still blocked; a later interaction will retry */ });
}

function startAudioChain(sources) {
  let idx = 0;
  const loadNext = () => {
    if (idx >= sources.length) return;
    music.src = sources[idx++];
    tryPlayMusic();
  };
  music.addEventListener("error", loadNext);
  INTERACTION_EVENTS.forEach((ev) => document.addEventListener(ev, tryPlayMusic));
  loadNext();
}

/* Extract the video id from watch/shorts/embed/youtu.be style links */
function youtubeId(url) {
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/* A YouTube page URL is not a media stream, so <audio> can't play it.
 * Instead we loop the video in a hidden 1×1 YouTube IFrame player. If the
 * API fails to load or the video forbids embedding, fall back to the
 * bundled ambient loop. */
function initYouTubeMusic(videoId) {
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
  const target = document.createElement("div");
  holder.appendChild(target);
  document.body.appendChild(holder);

  let failed = false;
  let ready = false;
  const fallback = () => {
    if (failed) return;
    failed = true;
    holder.remove();
    startAudioChain(["/static/audio/rift-ambience.wav"]);
  };

  // The script may load yet never initialise (blocked iframe, privacy
  // extensions, offline CDN) — in that case onError never fires either.
  const readyTimer = setTimeout(() => { if (!ready) fallback(); }, 15000);

  window.onYouTubeIframeAPIReady = () => {
    if (failed) return;
    const player = new YT.Player(target, {
      width: 1,
      height: 1,
      videoId,
      playerVars: { autoplay: 1, loop: 1, playlist: videoId, controls: 0, disablekb: 1, playsinline: 1 },
      events: {
        onReady: (e) => {
          ready = true;
          clearTimeout(readyTimer);
          e.target.setVolume(35);
          e.target.playVideo();
          // If autoplay was blocked, kick playback on the first interaction.
          const kick = () => {
            if (player.getPlayerState() === YT.PlayerState.PLAYING) {
              INTERACTION_EVENTS.forEach((ev) => document.removeEventListener(ev, kick));
            } else {
              player.playVideo();
            }
          };
          INTERACTION_EVENTS.forEach((ev) => document.addEventListener(ev, kick));
        },
        onError: () => { clearTimeout(readyTimer); fallback(); },
      },
    });
  };

  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  tag.onerror = () => { clearTimeout(readyTimer); fallback(); };
  document.head.appendChild(tag);
}

async function initMusic(configMusicUrl) {
  let localTrack = false;
  try {
    const head = await fetch("/static/audio/summoners-rift.mp3", { method: "HEAD" });
    localTrack = head.ok;
  } catch (_) { /* not provided */ }

  const ytId = !localTrack && configMusicUrl ? youtubeId(configMusicUrl) : null;
  if (ytId) return initYouTubeMusic(ytId);

  const sources = [];
  if (localTrack) sources.push("/static/audio/summoners-rift.mp3");
  if (configMusicUrl && !youtubeId(configMusicUrl)) sources.push(configMusicUrl);
  sources.push("/static/audio/rift-ambience.wav");
  startAudioChain(sources);
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
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 6e4);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
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

/* Data Dragon keys whose display name isn't just the key with spaces added */
const CHAMPION_DISPLAY_NAMES = {
  AurelionSol: "Aurelion Sol",
  Belveth: "Bel'Veth",
  Chogath: "Cho'Gath",
  DrMundo: "Dr. Mundo",
  JarvanIV: "Jarvan IV",
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  KSante: "K'Sante",
  Leblanc: "LeBlanc",
  MonkeyKing: "Wukong",
  Nunu: "Nunu & Willump",
  RekSai: "Rek'Sai",
  Renata: "Renata Glasc",
  Velkoz: "Vel'Koz",
};

/* "LeeSin" -> "Lee Sin", "MonkeyKing" -> "Wukong" */
function champDisplayName(champ) {
  return CHAMPION_DISPLAY_NAMES[champ] || champ.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function showError(msg) {
  const box = $("error-box");
  // Keep earlier messages so a profile error isn't hidden by a match error.
  box.textContent = box.hidden || !box.textContent ? msg : `${box.textContent}\n${msg}`;
  box.hidden = false;
}

function clearSkeleton() {
  $("match-list").innerHTML = "";
}

function renderProfile(p) {
  if (!p || p.error) {
    $("summoner-name").textContent = "Profile unavailable";
    return showError((p && p.error) || "Profile unavailable");
  }
  document.title = `${p.gameName} #${p.tagLine} · Rift Recap`;
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
  if (!Array.isArray(matches)) return showError((matches && matches.error) || "Could not load matches");
  if (!matches.length) {
    list.innerHTML = '<p class="match-sub">No recent games found.</p>';
    return;
  }
  matches.forEach((m) => list.appendChild(matchCard(m)));
}

async function getJson(url) {
  const res = await fetch(url);
  try {
    return await res.json();
  } catch (_) {
    throw new Error(`${url} returned ${res.status} ${res.statusText || ""}`.trim());
  }
}

async function init() {
  // Kick off all three requests at once; config only gates rendering.
  const configReq = getJson("/api/config");
  const profileReq = getJson("/api/profile");
  const matchesReq = getJson("/api/matches");
  // Failures are handled via allSettled below; swallow them here so a fast
  // rejection while config is still loading isn't reported as unhandled.
  [profileReq, matchesReq].forEach((req) => req.catch(() => {}));

  try {
    const config = await configReq;
    state.ddragonVersion = config.ddragonVersion || state.ddragonVersion;
    initMusic(config.musicUrl);
  } catch (err) {
    // Config is non-essential: fall back to the default Data Dragon version
    // and the bundled ambient loop.
    initMusic("");
  }

  const [profile, matches] = await Promise.allSettled([profileReq, matchesReq]);

  if (profile.status === "fulfilled") renderProfile(profile.value);
  else renderProfile({ error: `Failed to load profile: ${profile.reason.message}` });

  if (matches.status === "fulfilled") renderMatches(matches.value);
  else { clearSkeleton(); showError(`Failed to load matches: ${matches.reason.message}`); }
}

init();
