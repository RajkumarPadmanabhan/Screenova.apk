import { artwork } from "./art.js?v=2";
import { idbAll, idbClear, idbDel, idbGet, idbSet } from "./db.js";
import {
  buildLibrary,
  findEpisode,
  findItem,
  formatBytes,
  formatDuration,
  librarySignature,
  normalizeKey,
  playableExt,
  shortText,
} from "./library.js";
import { enrichItem } from "./metadata.js";
import { collectFromFileList, collectFromHandle } from "./scan.js";

const state = {
  route: { name: "home" },
  items: [],
  folderName: "",
  scanning: false,
  scanCount: 0,
  connected: false,
  needsPermission: false,
  permissionMode: "",
  myList: new Set(),
  progress: new Map(),
  fileMap: new Map(),
  urlCache: new Map(),
  lastSync: 0,
  preview: false,
  openSeason: null,
  player: null,
  keepScroll: false,
};

const view = () => document.getElementById("view");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function fileUrl(path) {
  if (!path) return "";
  if (state.urlCache.has(path)) return state.urlCache.get(path);
  const file = state.fileMap.get(path);
  if (!file) return "";
  const url = URL.createObjectURL(file);
  state.urlCache.set(path, url);
  return url;
}

function posterFor(item) {
  if (item.posterPath) {
    const local = fileUrl(item.posterPath);
    if (local) return local;
  }
  if (item.posterUrl) return item.posterUrl;
  return artwork(item.title, item.year, false);
}

function backdropFor(item) {
  if (item.backdropPath) {
    const local = fileUrl(item.backdropPath);
    if (local) return local;
  }
  if (item.backdropUrl) return item.backdropUrl;
  if (item.posterUrl && !item.posterPath) return item.posterUrl;
  return artwork(item.title, item.year, true);
}

function stillFor(episode, series) {
  if (episode?.stillPath) {
    const local = fileUrl(episode.stillPath);
    if (local) return local;
  }
  if (episode?.stillUrl) return episode.stillUrl;
  return posterFor(series);
}

function blurb(item) {
  if (item.description) return item.description;
  const genres = (item.genres || []).slice(0, 3).join(", ");
  return `${item.category} saved in your library${genres ? `, filed under ${genres}` : ""}. The file is ${formatBytes(item.size)}. A short synopsis appears when the title matches public details, or when a movie.nfo or tvshow.nfo file is in the same folder.`;
}

function ratingMarkup(item) {
  if (!item.rating) return `<span class="rating-line muted">Rating pending</span>`;
  const score = Number(item.rating);
  const label = item.imdb ? `IMDb ${score.toFixed(1)}` : score.toFixed(1);
  return `<span class="rating-line"><span class="stars" style="--p:${Math.max(0, Math.min(1, score / 10))}"><i></i></span><span class="score">${esc(label)}</span></span>`;
}

function readRoute() {
  const parts = (location.hash.replace(/^#/, "") || "/").split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: "home" };
  if (parts[0] === "movies") return { name: "movies", genre: parts[1] || "All" };
  if (parts[0] === "series") return { name: "series", genre: parts[1] || "All" };
  if (parts[0] === "browse") return { name: "browse", genre: parts[1] || "All" };
  if (parts[0] === "list") return { name: "list" };
  if (parts[0] === "search") return { name: "search" };
  if (parts[0] === "library") return { name: "library" };
  if (parts[0] === "title") return { name: "title", id: parts.slice(1).join("/") };
  return { name: "home" };
}

function currentNav() {
  if (state.route.name === "movies" || state.route.name === "browse") return "movies";
  if (state.route.name === "series") return "series";
  if (state.route.name === "list") return "list";
  if (state.route.name === "search") return "search";
  if (state.route.name === "library") return "library";
  return "home";
}

const movies = () => state.items.filter((item) => item.type === "movie");
const seriesItems = () => state.items.filter((item) => item.type === "series");
const recent = () => state.items.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 14);

function genreNames(list = state.items) {
  const names = new Set();
  for (const item of list) for (const genre of item.genres || []) names.add(genre);
  return [...names].sort();
}

function withGenre(list, genre) {
  if (!genre || genre === "All") return list;
  return list.filter((item) => (item.genres || []).includes(genre));
}

function featuredItem() {
  if (!state.items.length) return null;
  return state.items.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.addedAt || 0) - (a.addedAt || 0))[0];
}

function continueList() {
  const rows = [];
  for (const item of state.items) {
    const targets = item.type === "movie"
      ? item.versions.map((version) => ({ episode: null, version }))
      : item.seasons.flatMap((season) => season.episodes.flatMap((episode) => episode.versions.map((version) => ({ episode, version }))));
    for (const target of targets) {
      const progress = state.progress.get(target.version.filePath);
      if (!progress || progress.time < 8) continue;
      const ratio = progress.duration ? progress.time / progress.duration : 0;
      if (ratio >= 0.94) continue;
      rows.push({ item, ...target, progress });
    }
  }
  return rows.sort((a, b) => b.progress.updated - a.progress.updated).slice(0, 16);
}

function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2800);
}

function syncLabel() {
  if (state.scanning) return state.scanCount ? `Reading ${state.scanCount}` : "Reading folder";
  if (!state.connected && !state.items.length) return "Choose folder";
  if (state.needsPermission) return "Allow access";
  if (!state.lastSync) return "Refresh";
  const minutes = Math.round((Date.now() - state.lastSync) / 60000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  return `Synced ${Math.round(minutes / 60)}h ago`;
}

function paintChrome() {
  const nav = currentNav();
  document.querySelectorAll("[data-nav]").forEach((link) => link.classList.toggle("active", link.dataset.nav === nav));
  const sync = document.getElementById("sync");
  if (sync) sync.textContent = syncLabel();
}

function cacheItems(items) {
  return JSON.parse(JSON.stringify(items, (key, value) => {
    if (key === "file") return undefined;
    if (typeof value === "string" && value.startsWith("blob:")) return "";
    return value;
  }));
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    idbSet("kv", "catalog", {
      items: cacheItems(state.items),
      folderName: state.folderName,
      scannedAt: state.lastSync,
    });
  }, 700);
}

function card(item, land = false) {
  const meta = [item.category, item.year || "", formatBytes(item.size)].filter(Boolean).join(" · ");
  return `<article class="card ${land ? "land" : ""}" data-card="${esc(item.id)}">
    <button class="poster" data-act="open" data-id="${esc(item.id)}" type="button">
      <img src="${esc(posterFor(item))}" alt="">
      <span>${esc(item.title)}</span>
    </button>
    <div class="card-meta">
      <button class="name" data-act="open" data-id="${esc(item.id)}" type="button">${esc(item.title)}</button>
      <div data-rating>${ratingMarkup(item)}</div>
      <p>${esc(meta)}</p>
    </div>
  </article>`;
}

function row(title, items, { land = false, href = "" } = {}) {
  if (!items.length) return "";
  return `<section class="row">
    <div class="row-head"><h2>${esc(title)}</h2>${href ? `<a href="${href}">See all</a>` : ""}</div>
    <div class="scroller">${items.map((item) => card(item, land)).join("")}</div>
  </section>`;
}

function continueCard(entry) {
  const ratio = entry.progress.duration ? Math.min(100, Math.round((entry.progress.time / entry.progress.duration) * 100)) : 8;
  const label = entry.episode ? `${entry.item.title} · S${entry.episode.season} E${entry.episode.episode}` : entry.item.title;
  return `<article class="card land progress-card">
    <button class="poster" type="button" data-act="play" data-id="${esc(entry.item.id)}" data-ep="${esc(entry.episode?.id || "")}" data-file="${esc(entry.version.filePath)}">
      <img src="${esc(entry.episode ? stillFor(entry.episode, entry.item) : posterFor(entry.item))}" alt="">
      <span>${esc(label)}</span>
    </button>
    <div class="card-meta"><div class="bar"><i style="width:${ratio}%"></i></div><p>${ratio}% watched · ${esc(formatBytes(entry.version.size))}</p></div>
  </article>`;
}

function hero(item) {
  const episode = item.type === "series" ? item.seasons.find((season) => season.number < 1000)?.episodes[0] : null;
  return `<section class="hero" data-hero="${esc(item.id)}" data-bg="${esc(item.id)}">
    <div class="hero-copy">
      <p class="eyebrow">${esc(item.category)}${item.genres?.length ? ` · ${esc(item.genres.slice(0, 3).join(" · "))}` : ""}</p>
      <h1>${esc(item.title)}</h1>
      <div class="hero-meta">${ratingMarkup(item)}<span>${esc([item.year, formatDuration(item.duration), formatBytes(item.size), item.type === "series" ? `${item.seasons.filter((season) => season.number < 1000).length} seasons` : ""].filter(Boolean).join("  ·  "))}</span></div>
      <p class="synopsis" data-desc>${esc(shortText(blurb(item), 240))}</p>
      <div class="actions">
        <button class="play" type="button" data-act="play" data-id="${esc(item.id)}" data-ep="${esc(episode?.id || "")}">Play</button>
        <button class="ghost" type="button" data-act="list" data-list="${esc(item.id)}">${state.myList.has(item.id) ? "In My List" : "My List"}</button>
        <a class="ghost" href="#/title/${encodeURIComponent(item.id)}">Details</a>
      </div>
    </div>
  </section>`;
}

function banners() {
  let html = "";
  if (state.preview) {
    html += `<div class="banner preview"><p>This is a sample layout so you can see the shelves. Choose the folder on your device and these titles are replaced by your files.</p><button class="solid" type="button" data-act="choose">Choose folder</button></div>`;
  }
  if (state.needsPermission) {
    const name = state.folderName ? `“${esc(state.folderName)}”` : "your folder";
    html += `<div class="banner"><p>Allow Screenova to read ${name} again. New downloads show up after that, and playback stays on this device.</p><button class="solid" type="button" data-act="choose">Allow access</button></div>`;
  }
  return html;
}

function setupView() {
  return `<section class="setup">
    <p class="eyebrow">Local library</p>
    <h1>Your movies, already downloaded.</h1>
    <p class="lede">Choose the folder where your movies and series are saved. Screenova lists each file with its name, category, size, and artwork, and keeps every season of a series under one title.</p>
    <div class="actions"><button class="solid" type="button" data-act="choose">Choose folder</button></div>
    <ul class="points">
      <li>Movies and series are arranged by category.</li>
      <li>A season folder, or files named S01E02, becomes Season 1, Season 2, and so on.</li>
      <li>File size comes from the download. Rating, poster, and a short description are added when the title matches.</li>
    </ul>
    <p class="fine">Nothing is uploaded. Chrome and Edge can remember the folder and refresh when files change. Other browsers ask you to choose the folder again. Put poster.jpg or movie.nfo beside a title to use your own artwork and synopsis.</p>
    <div class="poster-row" aria-hidden="true"><div class="fake-poster"></div><div class="fake-poster"></div><div class="fake-poster"></div></div>
  </section>`;
}

function progressView() {
  return `<section class="progress-panel"><p class="eyebrow">Screenova</p><h1>Reading your library…</h1><p class="lede" data-scan>${state.scanCount ? `${state.scanCount} files found` : "Looking through the folder"}</p></section>`;
}

function homeView() {
  const feature = featuredItem();
  const groups = new Map();
  for (const item of state.items) {
    for (const genre of item.genres || []) {
      if (!groups.has(genre)) groups.set(genre, []);
      groups.get(genre).push(item);
    }
  }
  const genreRows = [...groups.entries()].filter(([, list]) => list.length).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  return `${banners()}${feature ? hero(feature) : ""}
    ${continueList().length ? `<section class="row"><div class="row-head"><h2>Continue watching</h2></div><div class="scroller">${continueList().map(continueCard).join("")}</div></section>` : ""}
    ${row("Recently added", recent(), { land: true })}
    ${row("Movies", movies().slice(0, 18), { href: "#/movies" })}
    ${row("Series", seriesItems().slice(0, 18), { href: "#/series" })}
    ${genreRows.map(([genre, list]) => row(genre, list.slice(0, 18), { href: `#/browse/${encodeURIComponent(genre)}` })).join("")}`;
}

function chips(active, names, base) {
  return `<div class="chips">${["All", ...names].map((genre) => `<button class="chip ${genre === active ? "on" : ""}" type="button" data-act="genre" data-base="${base}" data-genre="${esc(genre)}">${esc(genre)}</button>`).join("")}</div>`;
}

function gridView(kind, genre = "All") {
  const source = kind === "movie" ? movies() : kind === "series" ? seriesItems() : state.items;
  const list = withGenre(source, genre);
  const title = kind === "movie" ? "Movies" : kind === "series" ? "Series" : genre;
  return `<section class="page">${banners()}
    <div class="page-head"><h1>${esc(title)}</h1><span class="muted">${list.length} titles</span></div>
    ${chips(genre, genreNames(source), kind === "movie" ? "movies" : kind === "series" ? "series" : "browse")}
    ${list.length ? `<div class="grid">${list.map((item) => card(item)).join("")}</div>` : `<p class="lede" style="padding:16px">No titles in this category yet.</p>`}
  </section>`;
}

function detailView(item) {
  if (!item) return `<section class="setup"><h1>That title is no longer in the folder.</h1><a class="ghost" href="#/">Back home</a></section>`;
  const seasons = item.type === "series" ? item.seasons : [];
  const selected = seasons.some((season) => season.number === state.openSeason) ? state.openSeason : seasons[0]?.number;
  const season = seasons.find((entry) => entry.number === selected);
  const versions = item.type === "movie" ? item.versions : [];
  return `<section class="detail-hero" data-bg="${esc(item.id)}"></section>
    <section class="detail">
      <img class="detail-poster" src="${esc(posterFor(item))}" alt="">
      <div>
        <p class="eyebrow">${esc(item.category)}</p>
        <h1>${esc(item.title)}</h1>
        <div class="facts">
          ${ratingMarkup(item)}
          ${item.year ? `<span>${esc(item.year)}</span>` : ""}
          ${formatDuration(item.duration) ? `<span>${esc(formatDuration(item.duration))}</span>` : ""}
          <span>${esc(formatBytes(item.size))}</span>
          ${(item.genres || []).map((genre) => `<span>${esc(genre)}</span>`).join("")}
        </div>
        <p class="plot" data-plot>${esc(blurb(item))}</p>
        <div class="actions">
          <button class="play" type="button" data-act="play" data-id="${esc(item.id)}" data-ep="${esc(season?.episodes[0]?.id || "")}">Play</button>
          <button class="ghost" type="button" data-act="list" data-list="${esc(item.id)}">${state.myList.has(item.id) ? "In My List" : "My List"}</button>
        </div>
        ${item.credits?.length ? `<p class="credits">Details: ${esc(item.credits.join(", "))}. Video stays in your folder.</p>` : `<p class="credits">File size is read from your folder. Poster and synopsis fill in when a match is found.</p>`}
        ${versions.length > 1 ? `<h3>Versions</h3><div class="versions">${versions.map((version) => `<button class="version" type="button" data-act="play" data-id="${esc(item.id)}" data-file="${esc(version.filePath)}">${esc(version.quality || version.ext)} · ${esc(formatBytes(version.size))}</button>`).join("")}</div>` : ""}
        ${item.extras?.length ? `<h3>Extras</h3><div class="versions">${item.extras.map((extra) => `<button class="version" type="button" data-act="play" data-id="${esc(item.id)}" data-file="${esc(extra.filePath)}">${esc(extra.title)} · ${esc(formatBytes(extra.size))}</button>`).join("")}</div>` : ""}
        ${seasons.length ? `<div class="season-switch">${seasons.map((entry) => `<button class="season-btn ${entry.number === selected ? "on" : ""}" type="button" data-act="season" data-season="${entry.number}">${esc(entry.name)}</button>`).join("")}</div>
          <div>${(season?.episodes || []).map((episode) => `<button class="episode" type="button" data-act="play" data-id="${esc(item.id)}" data-ep="${esc(episode.id)}">
            <img src="${esc(stillFor(episode, item))}" alt="">
            <span><strong>${episode.episode ? `${episode.episode}. ` : ""}${esc(episode.title)}</strong>
            <small>${esc([formatDuration(episode.duration), formatBytes(episode.size), episode.versions[0]?.quality].filter(Boolean).join(" · "))}</small>
            ${episode.description ? `<em>${esc(shortText(episode.description, 140))}</em>` : ""}</span>
          </button>`).join("")}</div>` : ""}
      </div>
    </section>`;
}

function resultRow(item, extra = "") {
  return `<button class="result" type="button" data-act="open" data-id="${esc(item.id)}">
    <img src="${esc(posterFor(item))}" alt="">
    <span><strong>${esc(item.title)}</strong><small class="muted">${esc(extra || [item.category, item.year || "", formatBytes(item.size)].filter(Boolean).join(" · "))}</small></span>
  </button>`;
}

function searchView() {
  const query = document.getElementById("search")?.value || "";
  const q = normalizeKey(query);
  const hits = !q ? state.items : state.items.filter((item) => {
    if (normalizeKey(item.title).includes(q)) return true;
    if ((item.genres || []).some((genre) => normalizeKey(genre).includes(q))) return true;
    return item.type === "series" && item.seasons.some((season) => season.episodes.some((episode) => normalizeKey(episode.title).includes(q)));
  });
  return `<section class="search-page">${banners()}
    <h1>Search</h1>
    <input id="search-page" type="search" placeholder="Search titles, categories, episodes" value="${esc(query)}">
    <div class="results" data-results>${hits.length ? hits.slice(0, 40).map((item) => resultRow(item)).join("") : `<p class="muted">Nothing in your library matches that.</p>`}</div>
  </section>`;
}

function listView() {
  const saved = state.items.filter((item) => state.myList.has(item.id));
  return `<section class="page">${banners()}<div class="page-head"><h1>My List</h1></div>${saved.length ? `<div class="grid">${saved.map((item) => card(item)).join("")}</div>` : `<p class="lede" style="padding:16px">Save a title and it stays on this device.</p>`}</section>`;
}

function libraryView() {
  const total = state.items.reduce((sum, item) => sum + (item.size || 0), 0);
  const remembered = Boolean(window.showDirectoryPicker);
  return `<section class="library">${banners()}
    <p class="eyebrow">Library</p>
    <h1>${esc(state.folderName || "No folder yet")}</h1>
    <div class="stat-grid">
      <div class="stat"><b>${movies().length}</b><span>Movies</span></div>
      <div class="stat"><b>${seriesItems().length}</b><span>Series</span></div>
      <div class="stat"><b>${esc(formatBytes(total))}</b><span>On this device</span></div>
    </div>
    <p class="note">${esc(syncLabel())}. Screenova reads the folder again when you open this page, return to the tab, or press refresh. Add a download and it appears here. Remove one and it leaves.</p>
    <div class="actions">
      <button class="solid" type="button" data-act="refresh">Refresh folder</button>
      <button class="ghost" type="button" data-act="choose">Change folder</button>
      <button class="ghost" type="button" data-act="forget">Remove library</button>
    </div>
    <p class="note">${remembered ? "This browser can remember the folder after you allow it once." : "This browser cannot remember a folder path. Choose the folder again when you add files."} MP4 and WebM play here. MKV and AVI still appear in the library, with size and details, even when the browser cannot decode them.</p>
  </section>`;
}

function render() {
  const route = state.route;
  let html = progressView();
  if (!(state.scanning && !state.items.length)) {
    if (!state.items.length) html = setupView();
    else if (route.name === "movies") html = gridView("movie", route.genre);
    else if (route.name === "series") html = gridView("series", route.genre);
    else if (route.name === "browse") html = gridView("all", route.genre);
    else if (route.name === "list") html = listView();
    else if (route.name === "search") html = searchView();
    else if (route.name === "library") html = libraryView();
    else if (route.name === "title") html = detailView(findItem(state.items, route.id));
    else html = homeView();
  }
  const y = window.scrollY;
  view().innerHTML = html;
  paintChrome();
  document.querySelectorAll("[data-bg]").forEach((node) => {
    const item = findItem(state.items, node.dataset.bg);
    if (!item) return;
    const image = backdropFor(item).replace(/"/g, "");
    node.style.backgroundImage = `linear-gradient(90deg, rgba(7,7,8,.94), rgba(7,7,8,.62) 48%, rgba(7,7,8,.2)), linear-gradient(180deg, transparent 40%, #070708), url("${image}")`;
  });
  if (state.keepScroll) window.scrollTo(0, y);
  else window.scrollTo(0, 0);
}

function patchItem(item) {
  document.querySelectorAll(`[data-card="${CSS.escape(item.id)}"]`).forEach((node) => {
    const image = node.querySelector("img");
    const src = posterFor(item);
    if (image && image.src !== src) image.src = src;
    const rating = node.querySelector("[data-rating]");
    if (rating) rating.innerHTML = ratingMarkup(item);
  });
  const heroNode = document.querySelector(`[data-hero="${CSS.escape(item.id)}"]`);
  if (heroNode) {
    const desc = heroNode.querySelector("[data-desc]");
    if (desc) desc.textContent = shortText(blurb(item), 240);
    const meta = heroNode.querySelector(".hero-meta");
    if (meta) meta.innerHTML = `${ratingMarkup(item)}<span>${esc([item.year, formatDuration(item.duration), formatBytes(item.size)].filter(Boolean).join("  ·  "))}</span>`;
  }
  if (state.route.name === "title" && state.route.id === item.id) {
    const plot = document.querySelector("[data-plot]");
    if (plot) plot.textContent = blurb(item);
    const poster = document.querySelector(".detail-poster");
    if (poster) poster.src = posterFor(item);
  }
  const bg = document.querySelector(`[data-bg="${CSS.escape(item.id)}"]`);
  if (bg) {
    const image = backdropFor(item).replace(/"/g, "");
    bg.style.backgroundImage = `linear-gradient(90deg, rgba(7,7,8,.94), rgba(7,7,8,.62) 48%, rgba(7,7,8,.2)), linear-gradient(180deg, transparent 40%, #070708), url("${image}")`;
  }
}

function updateScanLabel() {
  const label = document.querySelector("[data-scan]");
  if (label) label.textContent = `${state.scanCount} files found`;
  paintChrome();
}

function rememberFiles(entries) {
  for (const url of state.urlCache.values()) URL.revokeObjectURL(url);
  state.urlCache.clear();
  state.fileMap = new Map();
  for (const entry of entries) if (entry.file) state.fileMap.set(entry.relativePath, entry.file);
}

function mergePrevious(items) {
  const previous = new Map(state.items.map((item) => [item.id, item]));
  for (const item of items) {
    const older = previous.get(item.id);
    if (!older) continue;
    if (!item.description && older.description) item.description = older.description;
    if (!item.rating && older.rating) {
      item.rating = older.rating;
      item.imdb = older.imdb;
    }
    if (!item.posterUrl && older.posterUrl) item.posterUrl = older.posterUrl;
    if (!item.backdropUrl && older.backdropUrl) item.backdropUrl = older.backdropUrl;
    if (!(item.genres || []).length && older.genres?.length) item.genres = [...older.genres];
    item.credits = older.credits || item.credits || [];
    if (item.type !== "series" || older.type !== "series") continue;
    const oldEpisodes = new Map();
    for (const season of older.seasons || []) for (const episode of season.episodes) oldEpisodes.set(`${season.number}:${episode.episode}`, episode);
    for (const season of item.seasons) {
      for (const episode of season.episodes) {
        const before = oldEpisodes.get(`${season.number}:${episode.episode}`);
        if (!before) continue;
        if (!episode.description && before.description) episode.description = before.description;
        if (!episode.stillUrl && before.stillUrl) episode.stillUrl = before.stillUrl;
        if (/^episode\s+\d+$/i.test(episode.title) && before.title) episode.title = before.title;
      }
    }
  }
}

async function adopt(entries, folderName, quiet) {
  const items = buildLibrary(entries);
  const previous = librarySignature(state.items);
  const next = librarySignature(items);
  rememberFiles(entries);
  if (quiet && previous && previous === next) {
    state.scanning = false;
    state.connected = true;
    state.needsPermission = false;
    state.lastSync = Date.now();
    paintChrome();
    return;
  }
  mergePrevious(items);
  const hadItems = state.items.length > 0;
  state.items = items;
  state.folderName = folderName || state.folderName;
  state.connected = true;
  state.preview = false;
  state.scanning = false;
  state.needsPermission = false;
  state.lastSync = Date.now();
  state.keepScroll = quiet && hadItems;
  await idbSet("kv", "catalog", { items: cacheItems(items), folderName: state.folderName, scannedAt: state.lastSync });
  render();
  if (previous && previous !== next) toast("Library updated from your folder");
  items.forEach((item, index) => enrichItem(item, (updated) => {
    patchItem(updated);
    scheduleSave();
  }, index < 6 ? 0 : 1));
}

async function scanHandle(handle, quiet = false) {
  if (state.scanning) return;
  state.scanning = true;
  state.scanCount = 0;
  state.connected = true;
  state.folderName = handle.name || state.folderName;
  state.keepScroll = quiet;
  if (!quiet || !state.items.length) render();
  else paintChrome();
  try {
    const entries = await collectFromHandle(handle, (count) => {
      state.scanCount = count;
      updateScanLabel();
    });
    await adopt(entries, handle.name, quiet);
  } catch (error) {
    console.error(error);
    state.scanning = false;
    state.needsPermission = true;
    toast("Screenova needs permission to read that folder again");
    render();
  }
}

async function chooseFolder() {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      await idbSet("kv", "handle", handle);
      state.permissionMode = "handle";
      await scanHandle(handle, false);
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  document.getElementById("folder-input").click();
}

async function rescanIfAllowed() {
  if (state.preview || state.scanning || state.permissionMode !== "handle") return;
  const handle = await idbGet("kv", "handle");
  if (!handle?.queryPermission) return;
  try {
    if (await handle.queryPermission({ mode: "read" }) === "granted") await scanHandle(handle, true);
  } catch { /* keep the current shelf */ }
}

async function refreshLibrary() {
  if (state.permissionMode === "handle") {
    const handle = await idbGet("kv", "handle");
    if (handle) {
      const permission = await handle.queryPermission({ mode: "read" });
      if (permission === "granted") {
        await scanHandle(handle, true);
        return;
      }
      state.needsPermission = true;
      render();
      return;
    }
  }
  if (!state.items.length) {
    await chooseFolder();
    return;
  }
  toast("Choose the folder again to refresh");
  await chooseFolder();
}

async function forgetFolder() {
  if (!confirm("Remove this library from Screenova on this device? The files stay in the folder.")) return;
  await idbDel("kv", "handle");
  await idbDel("kv", "catalog");
  await idbClear("progress");
  state.items = [];
  state.folderName = "";
  state.connected = false;
  state.needsPermission = false;
  state.progress.clear();
  state.myList.clear();
  await idbSet("kv", "list", []);
  rememberFiles([]);
  location.hash = "#/";
  render();
}

function primaryVersion(item, episode, filePath) {
  if (filePath) {
    const pools = item.type === "movie"
      ? [...item.versions, ...(item.extras || [])]
      : item.seasons.flatMap((season) => season.episodes.flatMap((entry) => entry.versions));
    const found = pools.find((version) => version.filePath === filePath);
    if (found) return found;
  }
  if (episode?.versions?.length) return episode.versions[0];
  return item.versions?.[0];
}

function clock(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

function srtToVtt(text) {
  return `WEBVTT\n\n${text.replace(/^\uFEFF/, "").replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}

function closePlayer() {
  const root = document.getElementById("player");
  const video = root.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  root.hidden = true;
  root.innerHTML = "";
  state.player = null;
}

async function openPlayer(item, episode, version) {
  const file = state.fileMap.get(version.filePath);
  if (!file) {
    toast("Choose the folder to play this file");
    if (state.needsPermission || !state.connected) await chooseFolder();
    return;
  }
  const root = document.getElementById("player");
  const title = episode ? `${item.title} · ${episode.title}` : item.title;
  root.innerHTML = `<div class="player-top"><button type="button" data-act="close-player">Close</button><strong>${esc(title)}</strong><span>${esc(version.quality || version.ext.toUpperCase())} · ${esc(formatBytes(version.size))}</span></div>
    <video playsinline></video>
    <p class="player-note" hidden></p>
    <div class="controls">
      <button type="button" data-act="toggle">Play</button>
      <button type="button" data-act="back10">-10s</button>
      <input class="seek" type="range" min="0" max="1000" value="0" aria-label="Seek">
      <span class="time">0:00</span>
      <button type="button" data-act="fwd10">+10s</button>
      <button type="button" data-act="full">Full</button>
    </div>`;
  root.hidden = false;
  const video = root.querySelector("video");
  const note = root.querySelector(".player-note");
  const seek = root.querySelector(".seek");
  const time = root.querySelector(".time");
  const toggle = root.querySelector("[data-act='toggle']");
  state.player = { item, episode, version, video };
  video.src = fileUrl(version.filePath);
  const saved = state.progress.get(version.filePath);
  openPlayer.savedAt = 0;
  video.addEventListener("loadedmetadata", () => {
    if (saved?.time && (!video.duration || saved.time < video.duration - 5)) video.currentTime = saved.time;
  });
  video.addEventListener("timeupdate", () => {
    const duration = video.duration || saved?.duration || 0;
    if (duration) seek.value = String(Math.round((video.currentTime / duration) * 1000));
    time.textContent = `${clock(video.currentTime)} / ${clock(duration)}`;
    if (video.currentTime > 2 && Date.now() - openPlayer.savedAt > 4000) {
      openPlayer.savedAt = Date.now();
      const row = { path: version.filePath, time: video.currentTime, duration, updated: Date.now() };
      state.progress.set(version.filePath, row);
      idbSet("progress", version.filePath, row);
    }
  });
  video.addEventListener("pause", () => {
    const row = { path: version.filePath, time: video.currentTime, duration: video.duration || 0, updated: Date.now() };
    state.progress.set(version.filePath, row);
    idbSet("progress", version.filePath, row);
  });
  video.addEventListener("play", () => { toggle.textContent = "Pause"; });
  video.addEventListener("pause", () => { toggle.textContent = "Play"; });
  video.addEventListener("error", () => {
    note.hidden = false;
    note.textContent = playableExt(version.ext)
      ? "This file could not be played."
      : `${version.ext.toUpperCase()} is in your library, but this browser usually cannot play it. The title, size, and details stay visible. MP4 and WebM play here.`;
  });
  video.addEventListener("ended", () => {
    const next = nextEpisode(item, episode);
    if (next) toast("Next episode is ready");
  });
  const subtitle = version.subtitlePath || episode?.subtitlePath || item.subtitlePath;
  const subFile = subtitle ? state.fileMap.get(subtitle) : null;
  if (subFile) {
    let text = await subFile.text();
    if (/\.srt$/i.test(subtitle)) text = srtToVtt(text);
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = "Subtitles";
    track.srclang = "en";
    track.default = true;
    track.src = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
    video.appendChild(track);
  }
  try { await video.play(); } catch { /* user can press play */ }
}

function nextEpisode(item, episode) {
  if (!episode || item.type !== "series") return null;
  const list = item.seasons.flatMap((season) => season.episodes);
  const index = list.findIndex((entry) => entry.id === episode.id);
  return list[index + 1] || null;
}

function onSearchInput(event) {
  const other = event.target.id === "search" ? document.getElementById("search-page") : document.getElementById("search");
  if (other && other.value !== event.target.value) other.value = event.target.value;
  if (state.route.name !== "search") {
    if (event.target.value.trim()) location.hash = "#/search";
    return;
  }
  const box = document.querySelector("[data-results]");
  if (!box) return;
  const query = normalizeKey(event.target.value);
  const hits = !query ? state.items : state.items.filter((item) => normalizeKey(`${item.title} ${(item.genres || []).join(" ")}`).includes(query) || (item.type === "series" && item.seasons.some((season) => season.episodes.some((episode) => normalizeKey(episode.title).includes(query)))));
  box.innerHTML = hits.length ? hits.slice(0, 40).map((item) => resultRow(item)).join("") : `<p class="muted">Nothing in your library matches that.</p>`;
}

async function onClick(event) {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (act === "choose") return chooseFolder();
  if (act === "refresh") return refreshLibrary();
  if (act === "forget") return forgetFolder();
  if (act === "open") {
    location.hash = `#/title/${encodeURIComponent(button.dataset.id)}`;
    return;
  }
  if (act === "genre") {
    const genre = button.dataset.genre === "All" ? "" : `/${encodeURIComponent(button.dataset.genre)}`;
    location.hash = `#/${button.dataset.base}${genre}`;
    return;
  }
  if (act === "season") {
    state.openSeason = Number(button.dataset.season);
    state.keepScroll = true;
    render();
    return;
  }
  if (act === "list") {
    const id = button.dataset.list;
    if (state.myList.has(id)) state.myList.delete(id);
    else state.myList.add(id);
    await idbSet("kv", "list", [...state.myList]);
    button.textContent = state.myList.has(id) ? "In My List" : "My List";
    if (state.route.name === "list") render();
    return;
  }
  if (act === "play") {
    const item = findItem(state.items, button.dataset.id);
    if (!item) return;
    const episode = item.type === "series" ? findEpisode(item, button.dataset.ep) : null;
    const version = primaryVersion(item, episode, button.dataset.file);
    if (version) await openPlayer(item, episode, version);
    return;
  }
  if (act === "close-player") return closePlayer();
  if (!state.player) return;
  const video = state.player.video;
  if (act === "toggle") video.paused ? video.play() : video.pause();
  if (act === "back10") video.currentTime = Math.max(0, video.currentTime - 10);
  if (act === "fwd10") video.currentTime = Math.min(video.duration || video.currentTime + 10, video.currentTime + 10);
  if (act === "full") {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.getElementById("player").requestFullscreen?.();
  }
}

function onPlayerInput(event) {
  if (!event.target.classList.contains("seek") || !state.player) return;
  const video = state.player.video;
  if (!video.duration) return;
  video.currentTime = (Number(event.target.value) / 1000) * video.duration;
}

async function restore() {
  const [catalog, list, progress] = await Promise.all([
    idbGet("kv", "catalog"),
    idbGet("kv", "list"),
    idbAll("progress"),
  ]);
  if (catalog?.items?.length) {
    state.items = catalog.items;
    state.folderName = catalog.folderName || "";
    state.lastSync = catalog.scannedAt || 0;
    state.connected = true;
  }
  state.myList = new Set(list || []);
  for (const row of progress || []) if (row?.path) state.progress.set(row.path, row);
  const params = new URLSearchParams(location.search);
  if (params.get("preview") === "1") {
    const { previewLibrary } = await import("./preview.js");
    state.items = previewLibrary();
    state.folderName = "Sample layout";
    state.preview = true;
    state.connected = true;
    render();
    return;
  }
  render();
  const handle = await idbGet("kv", "handle");
  if (!handle?.queryPermission) {
    if (state.items.length) state.needsPermission = true;
    if (state.items.length) {
      state.items.forEach((item, index) => enrichItem(item, (updated) => {
        patchItem(updated);
        scheduleSave();
      }, index < 6 ? 0 : 1));
    }
    render();
    return;
  }
  state.permissionMode = "handle";
  try {
    const permission = await handle.queryPermission({ mode: "read" });
    if (permission === "granted") await scanHandle(handle, Boolean(state.items.length));
    else {
      state.needsPermission = true;
      state.folderName = handle.name || state.folderName;
      render();
    }
  } catch {
    state.needsPermission = true;
    render();
  }
}

function bind() {
  document.body.addEventListener("click", onClick);
  document.body.addEventListener("input", (event) => {
    if (event.target.id === "search" || event.target.id === "search-page") onSearchInput(event);
    if (event.target.classList?.contains("seek")) onPlayerInput(event);
  });
  document.getElementById("folder-input").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    if (!files.length) return;
    state.permissionMode = "input";
    state.scanning = true;
    state.scanCount = 0;
    if (!state.items.length) render();
    const entries = await collectFromFileList(files, (count) => {
      state.scanCount = count;
      updateScanLabel();
    });
    const folderName = files[0].webkitRelativePath?.split("/")[0] || "Library";
    await adopt(entries, folderName, false);
  });
  window.addEventListener("hashchange", () => {
    state.route = readRoute();
    state.keepScroll = false;
    state.openSeason = null;
    render();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) rescanIfAllowed();
  });
  document.addEventListener("keydown", (event) => {
    if (!state.player || event.target.matches("input, textarea")) return;
    if (event.key === "Escape") closePlayer();
    if (event.key === " ") {
      event.preventDefault();
      state.player.video.paused ? state.player.video.play() : state.player.video.pause();
    }
    if (event.key === "ArrowRight") state.player.video.currentTime += 10;
    if (event.key === "ArrowLeft") state.player.video.currentTime -= 10;
    if (event.key.toLowerCase() === "f") document.getElementById("player").requestFullscreen?.();
  });
  setInterval(() => {
    if (!document.hidden) rescanIfAllowed();
  }, 45000);
}

state.route = readRoute();
bind();
restore().catch((error) => {
  console.error(error);
  render();
});
