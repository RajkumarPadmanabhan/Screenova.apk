import { artwork } from "./art.js?v=3";
import { idbAll, idbClear, idbDel, idbGet, idbSet } from "./db.js";
import {
  buildLibrary,
  findEpisode,
  findItem,
  formatBytes,
  formatDuration,
  librarySignature,
  normalizeKey,
  polishLibrary,
  shortText,
} from "./library.js?v=11";
import { enrichItem, remotePoster } from "./metadata.js";
import { fileWantsDemux, languageFromName, loadMovi, moviWasmUrl, vttFile } from "./playback.js";
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
  skin: "netflix",
  dashQuery: "",
};

const BRAND = "Netflix oh";

function shownName(item) {
  return item?.sourceName || item?.title || "";
}

function episodeName(episode) {
  return episode?.sourceName || episode?.title || "";
}
const playIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5L7 4.5z"></path></svg>`;
const infoIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v6"></path><path d="M12 7.5h.01"></path></svg>`;
const plusIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>`;
const checkIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7"></path></svg>`;

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

function secureUrl(url) {
  return String(url || "").replace(/^http:\/\//i, "https://");
}

function imageSources(item, wide = false) {
  const list = [];
  if (item?.posterPath) {
    const local = fileUrl(item.posterPath);
    if (local) list.push(local);
  }
  if (item?.posterUrl) list.push(secureUrl(item.posterUrl));
  for (const extra of item?.posterAlts || []) {
    const url = secureUrl(extra);
    if (url) list.push(url);
  }
  list.push(artwork(item?.title || "Title", item?.year, wide));
  return [...new Set(list.filter(Boolean))];
}

function imageTag(item, { wide = false, alt = "", show = "", className = "" } = {}) {
  const sources = imageSources(item, wide);
  const [src, ...alts] = sources;
  const kind = item?.type === "series" ? "series" : "movie";
  return `<img${className ? ` class="${className}"` : ""} src="${esc(src || "")}" data-alts="${esc(alts.join("|"))}" alt="${esc(alt || item?.title || "")}" data-year="${esc(item?.year || "")}" data-wide="${wide ? "1" : "0"}" data-kind="${kind}" data-show="${esc(show || item?.title || "")}">`;
}

function applyImage(image, item, wide) {
  const sources = imageSources(item, wide);
  const [src, ...alts] = sources;
  if (!src) return;
  image.dataset.alts = alts.join("|");
  image.dataset.fallback = "";
  image.dataset.tried = "";
  image.dataset.show = item?.title || image.dataset.show || "";
  if (image.getAttribute("src") !== src) image.src = src;
}

function posterFor(item) {
  return imageSources(item, false)[0] || "";
}

function backdropFor(item) {
  if (item.backdropPath) {
    const local = fileUrl(item.backdropPath);
    if (local) return local;
  }
  if (item.backdropUrl) return item.backdropUrl;
  if (item.posterUrl && !item.posterPath) return item.posterUrl;
  return artwork(shownName(item), item.year, true);
}

function stillFor(episode, series) {
  if (episode?.stillPath) {
    const local = fileUrl(episode.stillPath);
    if (local) return local;
  }
  if (episode?.stillUrl) return secureUrl(episode.stillUrl);
  return posterFor(series);
}

function stillTag(episode, series, className = "") {
  const sources = [];
  if (episode?.stillPath) {
    const local = fileUrl(episode.stillPath);
    if (local) sources.push(local);
  }
  if (episode?.stillUrl) sources.push(secureUrl(episode.stillUrl));
  sources.push(...imageSources(series, true));
  const unique = [...new Set(sources.filter(Boolean))];
  const [src, ...alts] = unique;
  return `<img${className ? ` class="${className}"` : ""} src="${esc(src || "")}" data-alts="${esc(alts.join("|"))}" alt="${esc(episode?.title || series?.title || "")}" data-year="${esc(series?.year || "")}" data-wide="1" data-kind="series" data-show="${esc(series?.title || "")}">`;
}

function blurb(item) {
  if (item.description) return item.description;
  const genres = (item.genres || []).slice(0, 3).join(", ");
  return `${item.category} saved in your library${genres ? `, filed under ${genres}` : ""}. The file is ${formatBytes(item.size)}. A short synopsis appears when the title matches public details, or when a movie.nfo or tvshow.nfo file is in the same folder.`;
}

function displayRating(item) {
  const score = Number(item?.rating);
  if (Number.isFinite(score) && score > 0) return { score, imdb: Boolean(item.imdb) };
  const text = `${item?.title || "title"}|${item?.year || ""}`;
  let hash = 0;
  for (const char of text) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return { score: 6.4 + (hash % 21) / 10, imdb: false };
}

function ratingMarkup(item) {
  const rating = displayRating(item);
  const label = rating.imdb ? `IMDb ${rating.score.toFixed(1)}` : rating.score.toFixed(1);
  return `<span class="rating-line"><span class="stars" style="--p:${Math.max(0, Math.min(1, rating.score / 10))}"><i></i></span><span class="score">${esc(label)}</span></span>`;
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
  return trending()[0] || null;
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

function onMeta(updated, info) {
  if (info?.invalidKey) {
    state.omdbKeyError = true;
    if (!onMeta.told) {
      onMeta.told = true;
      toast("OMDb rejected the API key. Titles stay without a poster or director until the key is valid.");
    }
    const note = document.querySelector("[data-omdb]");
    if (note) note.hidden = false;
    return;
  }
  if (!updated) return;
  patchItem(updated);
  scheduleSave();
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

function copy() {
  return {
    brand: BRAND,
    home: "Home",
    movies: "Movies",
    series: "TV Shows",
    list: "My List",
    search: "Search",
    library: "Downloads",
    play: "Play",
    listAdd: "My List",
    listOn: "In My List",
    recent: "Recently Added",
    continue: "Continue Watching",
  };
}

function applySkin() {
  document.body.classList.add("skin-netflix");
  document.body.classList.remove("gate", "skin-prime");
  const words = copy();
  const brand = document.getElementById("brand-name");
  if (brand) brand.textContent = words.brand;
  document.title = BRAND;
  document.querySelectorAll("[data-label]").forEach((node) => {
    const key = node.dataset.label;
    if (words[key]) node.textContent = words[key];
  });
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.content = "#141414";
}

function paintChrome() {
  applySkin();
  const nav = currentNav();
  document.querySelectorAll("[data-nav]").forEach((link) => link.classList.toggle("active", link.dataset.nav === nav));
  const sync = document.getElementById("sync");
  if (sync) {
    const label = state.items.length || state.connected ? syncLabel() : "Add files";
    sync.setAttribute("aria-label", label);
    sync.title = label;
  }
  const logout = document.getElementById("logout");
  if (logout) logout.hidden = state.preview || !(state.connected || state.items.length);
  document.body.classList.toggle("intro", !state.preview && !state.scanning && !state.items.length);
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
  const rating = displayRating(item);
  const name = shownName(item);
  return `<article class="card ${land ? "land" : ""}" data-card="${esc(item.id)}">
    <button class="poster" data-act="open" data-id="${esc(item.id)}" type="button">
      ${imageTag(item, { wide: land, alt: name })}
      <span class="rate-badge">${rating.score.toFixed(1)}</span>
      <span class="hover-title">${esc(name)}</span>
    </button>
  </article>`;
}

function row(title, items, { land = false, href = "" } = {}) {
  if (!items.length) return "";
  return `<section class="row">
    <div class="row-head"><h2>${esc(title)}</h2>${href ? `<a href="${href}">See all</a>` : ""}</div>
    <div class="row-wrap">
      <button class="row-arrow prev" type="button" data-act="row-scroll" data-dir="-1" aria-label="Previous">‹</button>
      <div class="scroller">${items.map((item) => card(item, land)).join("")}</div>
      <button class="row-arrow next" type="button" data-act="row-scroll" data-dir="1" aria-label="Next">›</button>
    </div>
  </section>`;
}

function trending() {
  return state.items.slice().sort((a, b) => {
    const rating = (Number(b.rating) || 0) - (Number(a.rating) || 0);
    if (rating) return rating;
    return (b.year || 0) - (a.year || 0) || (b.addedAt || 0) - (a.addedAt || 0);
  });
}

function continueCard(entry) {
  const ratio = entry.progress.duration ? Math.min(100, Math.round((entry.progress.time / entry.progress.duration) * 100)) : 8;
  const label = entry.episode ? `${shownName(entry.item)} · S${entry.episode.season} E${entry.episode.episode}` : shownName(entry.item);
  return `<article class="card land progress-card">
    <button class="poster" type="button" data-act="play" data-id="${esc(entry.item.id)}" data-ep="${esc(entry.episode?.id || "")}" data-file="${esc(entry.version.filePath)}">
      ${entry.episode ? stillTag(entry.episode, entry.item) : imageTag(entry.item, { wide: true, alt: shownName(entry.item) })}
      <span>${esc(label)}</span>
      <span class="cw-bar"><i style="width:${ratio}%"></i></span>
    </button>
  </article>`;
}

function qualityLabel(item) {
  const version = item.type === "movie"
    ? item.versions?.[0]
    : item.seasons?.find((season) => season.number < 1000)?.episodes?.[0]?.versions?.[0];
  const label = String(version?.quality || "");
  if (/2160|4k|uhd/i.test(label)) return "4K";
  if (/1080|720|hd/i.test(label)) return "HD";
  return "";
}

function billboardMeta(item) {
  const seasons = item.type === "series" ? item.seasons.filter((season) => season.number < 1000).length : 0;
  const quality = qualityLabel(item);
  const bits = [
    `<span class="match">${Math.max(0, Math.min(100, Math.round(displayRating(item).score * 10)))}% Match</span>`,
    item.year ? `<span>${esc(item.year)}</span>` : "",
    seasons ? `<span>${seasons} Season${seasons === 1 ? "" : "s"}</span>` : "",
    formatDuration(item.duration) ? `<span>${esc(formatDuration(item.duration))}</span>` : "",
    quality ? `<span class="hd">${esc(quality)}</span>` : "",
  ];
  return bits.filter(Boolean).join("");
}

function listButton(item) {
  const on = state.myList.has(item.id);
  return `<button class="icon-round" type="button" data-act="list" data-list="${esc(item.id)}" aria-label="${esc(on ? copy().listOn : copy().listAdd)}">${on ? checkIcon : plusIcon}</button>`;
}

function heroSlider(items) {
  const slides = items.slice(0, 6);
  if (!slides.length) return "";
  if (slides.length === 1) return hero(slides[0]);
  return `<section class="hero-slider" data-slider>
    <button class="hero-arrow prev" type="button" data-act="hero-slide" data-dir="-1" aria-label="Previous title">‹</button>
    ${slides.map((item, index) => hero(item).replace('class="hero"', `class="hero hero-slide${index === 0 ? " on" : ""}" data-slide="${index}"`)).join("")}
    <button class="hero-arrow next" type="button" data-act="hero-slide" data-dir="1" aria-label="Next title">›</button>
    <div class="hero-dots">${slides.map((_, index) => `<button type="button" class="${index === 0 ? "on" : ""}" data-act="hero-slide" data-index="${index}" data-dot aria-label="Title ${index + 1}"></button>`).join("")}</div>
  </section>`;
}

function creditLine() {
  return `<footer class="site-foot">
    <div class="site-foot-who"><strong>R Rajkumar Padmanabhan</strong><span>Developer</span></div>
    <a href="https://www.instagram.com/i.rajkumar__/" target="_blank" rel="noopener noreferrer">Instagram · @i.rajkumar__</a>
  </footer>`;
}

function hero(item) {
  const episode = item.type === "series" ? item.seasons.find((season) => season.number < 1000)?.episodes[0] : null;
  return `<section class="hero" data-hero="${esc(item.id)}" data-bg="${esc(item.id)}">
    <div class="hero-copy">
      <p class="eyebrow">${esc(item.category)}</p>
      <h1>${esc(shownName(item))}</h1>
      <div class="hero-meta">${billboardMeta(item)}</div>
      <p class="synopsis" data-desc>${esc(shortText(blurb(item), 180))}</p>
      <div class="actions">
        <button class="play" type="button" data-act="play" data-id="${esc(item.id)}" data-ep="${esc(episode?.id || "")}">${playIcon}<span>${esc(copy().play)}</span></button>
        <a class="more" href="#/title/${encodeURIComponent(item.id)}">${infoIcon}<span>More Info</span></a>
        ${listButton(item)}
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
    html += `<div class="banner"><p>Allow ${BRAND} to read ${name} once. After that, every movie and series in it plays without asking for a path again.</p><button class="solid" type="button" data-act="allow">Allow access</button></div>`;
  }
  return html;
}

function setupView() {
  return `<section class="setup landing">
    <div class="landing-hero">
      <h1>Your Unlimited Collections</h1>
      <button class="signup" type="button" data-act="choose">Free <span aria-hidden="true">›</span></button>
    </div>
    ${creditLine()}
  </section>
  <section class="landing-more">
    <div class="faq">
      <button class="faq-q" type="button" data-act="faq" aria-expanded="false">What is this? <span class="faq-mark">+</span></button>
      <p class="faq-a" hidden>${esc(BRAND)} is a private screen for movies and series already saved on this device. Pick a folder and those files are laid out with posters, ratings, and seasons. Nothing in the folder is uploaded.</p>
      <button class="faq-q" type="button" data-act="faq" aria-expanded="false">How does it work? <span class="faq-mark">+</span></button>
      <p class="faq-a" hidden>Choose the folder once. Each card uses the name already on that file or folder. Seasons stay together, and multi-part movies stay in part order. A poster and rating are added for every title. Press Play to watch. Chrome and Edge can open the same folder again later.</p>
    </div>
    <ul class="points">
      <li>Add the folder once. ${esc(BRAND)} sorts each file as a movie or a series and does not ask for a path again.</li>
      <li>A season folder, or files named S01E02, becomes Season 1, Season 2, and so on.</li>
      <li>Part 1, CD1, or 1of2 stays Part 1, and the next part follows it.</li>
    </ul>
    <p class="fine">Nothing is uploaded. Chrome and Edge can remember the folder and refresh when files change. Other browsers ask you to choose the folder again.</p>
  </section>`;
}

function progressView() {
  return `<section class="progress-panel"><p class="eyebrow">${esc(BRAND)}</p><h1>Reading your library…</h1><p class="lede" data-scan>${state.scanCount ? `${state.scanCount} files found` : "Looking through the folder"}</p></section>`;
}

function homeView() {
  const picks = trending();
  const groups = new Map();
  for (const item of state.items) {
    for (const genre of item.genres || []) {
      if (!groups.has(genre)) groups.set(genre, []);
      groups.get(genre).push(item);
    }
  }
  const genreRows = [...groups.entries()].filter(([, list]) => list.length).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const words = copy();
  return `${banners()}${heroSlider(picks)}
    ${continueList().length ? `<section class="row"><div class="row-head"><h2>${esc(words.continue)}</h2></div><div class="row-wrap"><button class="row-arrow prev" type="button" data-act="row-scroll" data-dir="-1" aria-label="Previous">‹</button><div class="scroller">${continueList().map(continueCard).join("")}</div><button class="row-arrow next" type="button" data-act="row-scroll" data-dir="1" aria-label="Next">›</button></div></section>` : ""}
    ${row("Trending Now", picks.slice(0, 18))}
    ${row(words.recent, recent())}
    ${row(words.movies, movies().slice(0, 18), { href: "#/movies" })}
    ${row(words.series, seriesItems().slice(0, 18), { href: "#/series" })}
    ${genreRows.map(([genre, list]) => row(genre, list.slice(0, 18), { href: `#/browse/${encodeURIComponent(genre)}` })).join("")}
    ${creditLine()}`;
}

function chips(active, names, base) {
  return `<div class="chips">${["All", ...names].map((genre) => `<button class="chip ${genre === active ? "on" : ""}" type="button" data-act="genre" data-base="${base}" data-genre="${esc(genre)}">${esc(genre)}</button>`).join("")}</div>`;
}

function gridView(kind, genre = "All") {
  const source = kind === "movie" ? movies() : kind === "series" ? seriesItems() : state.items;
  const list = kind === "series" ? source : withGenre(source, genre);
  const words = copy();
  const title = kind === "movie" ? words.movies : kind === "series" ? words.series : genre;
  const filters = kind === "series" ? "" : chips(genre, genreNames(source), kind === "movie" ? "movies" : "browse");
  return `<section class="page">${banners()}
    <div class="page-head"><h1>${esc(title)}</h1><span class="muted">${list.length} titles</span></div>
    ${filters}
    ${list.length ? `<div class="grid">${list.map((item) => card(item)).join("")}</div>` : `<p class="lede" style="padding:16px">No titles in this category yet.</p>`}
  </section>`;
}

function factMarkup(item) {
  const bits = [
    ratingMarkup(item),
    item.year ? `<span>${esc(item.year)}</span>` : "",
    item.released ? `<span>${esc(item.released)}</span>` : "",
    item.director ? `<span>Directed by ${esc(item.director)}</span>` : "",
    formatDuration(item.duration) ? `<span>${esc(formatDuration(item.duration))}</span>` : "",
    `<span>${esc(formatBytes(item.size))}</span>`,
    item.rottenTomatoes ? `<span>Rotten Tomatoes ${esc(item.rottenTomatoes)}</span>` : "",
    item.metacritic ? `<span>Metacritic ${esc(item.metacritic)}</span>` : "",
    ...(item.genres || []).map((genre) => `<span>${esc(genre)}</span>`),
  ];
  return bits.filter(Boolean).join("");
}

function videoCount(item) {
  if (!item) return 0;
  if (item.type === "movie") return (item.versions?.length || 0) + (item.extras?.length || 0);
  return (item.seasons || []).reduce((sum, season) => sum + (season.episodes || []).reduce((inner, episode) => inner + (episode.versions?.length || 0), 0), 0);
}

function hasDetails(item) {
  return Boolean(item.director || item.imdbId || item.posterUrl || item.metaSource);
}

function dashTitles(query) {
  const q = normalizeKey(query);
  if (!q) return state.items;
  return state.items.filter((item) => normalizeKey(`${shownName(item)} ${item.title} ${item.director || ""} ${item.showDir || ""} ${(item.genres || []).join(" ")}`).includes(q));
}

function dashFiles(query) {
  const q = normalizeKey(query);
  const rows = [];
  for (const item of state.items) {
    const files = item.type === "movie"
      ? [...(item.versions || []), ...(item.extras || [])]
      : (item.seasons || []).flatMap((season) => (season.episodes || []).flatMap((episode) => episode.versions || []));
    for (const file of files) {
      const path = file.filePath || "";
      if (q && !normalizeKey(`${shownName(item)} ${item.title} ${path}`).includes(q)) continue;
      rows.push({ item, path, size: file.size || 0, kind: file.quality || file.ext || "" });
    }
  }
  return rows;
}

function dashTitleRow(item) {
  const status = state.preview ? "Sample layout" : hasDetails(item) ? (item.metaSource || "Matched") : (item.omdbChecked ? "No public match" : "Looking up");
  return `<tr data-dash="${esc(item.id)}">
    <td><button class="dash-title" type="button" data-act="open" data-id="${esc(item.id)}">${imageTag(item, { alt: shownName(item) })}<span><strong>${esc(shownName(item))}</strong><small>${esc(item.showDir || item.category)}</small></span></button></td>
    <td>${esc(item.category)}</td>
    <td>${esc(item.year || "—")}</td>
    <td>${esc(item.director || "—")}</td>
    <td>${item.rating ? esc(Number(item.rating).toFixed(1)) : "—"}</td>
    <td>${esc(formatBytes(item.size))}</td>
    <td>${videoCount(item)}</td>
    <td>${esc(status)}</td>
  </tr>`;
}

function detailView(item) {
  if (!item) return `<section class="setup"><h1>That title is no longer in the folder.</h1><a class="ghost" href="#/">Back home</a></section>`;
  const seasons = item.type === "series" ? item.seasons : [];
  const selected = seasons.some((season) => season.number === state.openSeason) ? state.openSeason : seasons[0]?.number;
  const season = seasons.find((entry) => entry.number === selected);
  const versions = item.type === "movie" ? item.versions : [];
  return `<section class="detail-hero" data-bg="${esc(item.id)}"></section>
    <section class="detail">
      ${imageTag(item, { className: "detail-poster", alt: shownName(item) })}
      <div>
        <p class="eyebrow">${esc(item.category)}</p>
        <h1>${esc(shownName(item))}</h1>
        <div class="facts">${factMarkup(item)}</div>
        <p class="plot" data-plot>${esc(blurb(item))}</p>
        <div class="actions">
          <button class="play" type="button" data-act="play" data-id="${esc(item.id)}" data-ep="${esc(season?.episodes[0]?.id || "")}">${playIcon}<span>${esc(copy().play)}</span></button>
          <button class="more" type="button" data-act="list" data-list="${esc(item.id)}"><span data-list-label>${state.myList.has(item.id) ? esc(copy().listOn) : esc(copy().listAdd)}</span></button>
        </div>
        ${item.credits?.length ? `<p class="credits">Details: ${esc(item.credits.join(", "))}. Video stays in your folder. Audio tracks and subtitles in the file can be switched while it plays.</p>` : `<p class="credits">File size is read from your folder. While a title plays, switch audio and subtitles from the file, search this folder, or upload an SRT, VTT, or ASS subtitle.</p>`}
        ${versions.length > 1 ? `<h3>${versions.some((version) => version.part) ? "Parts" : "Versions"}</h3><div class="versions">${versions.map((version) => `<button class="version" type="button" data-act="play" data-id="${esc(item.id)}" data-file="${esc(version.filePath)}">${esc([version.part ? `Part ${version.part}` : "", version.quality || version.ext, formatBytes(version.size)].filter(Boolean).join(" · "))}</button>`).join("")}</div>` : ""}
        ${item.extras?.length ? `<h3>Extras</h3><div class="versions">${item.extras.map((extra) => `<button class="version" type="button" data-act="play" data-id="${esc(item.id)}" data-file="${esc(extra.filePath)}">${esc(extra.sourceName || extra.title)} · ${esc(formatBytes(extra.size))}</button>`).join("")}</div>` : ""}
        ${seasons.length ? `<div class="season-switch">${seasons.map((entry) => `<button class="season-btn ${entry.number === selected ? "on" : ""}" type="button" data-act="season" data-season="${entry.number}">${esc(entry.name)}</button>`).join("")}</div>
          <div>${(season?.episodes || []).map((episode) => `<button class="episode" type="button" data-act="play" data-id="${esc(item.id)}" data-ep="${esc(episode.id)}">
            ${stillTag(episode, item)}
            <span><strong>${episode.episode ? `${episode.episode}. ` : ""}${esc(episodeName(episode))}</strong>
            <small>${esc([formatDuration(episode.duration), formatBytes(episode.size), episode.versions[0]?.quality].filter(Boolean).join(" · "))}</small>
            ${episode.description ? `<em>${esc(shortText(episode.description, 140))}</em>` : ""}</span>
          </button>`).join("")}</div>` : ""}
      </div>
    </section>`;
}

function searchView() {
  const query = document.getElementById("search")?.value || "";
  const q = normalizeKey(query);
  const hits = !q ? state.items : state.items.filter((item) => {
    if (normalizeKey(`${shownName(item)} ${item.title}`).includes(q)) return true;
    if ((item.genres || []).some((genre) => normalizeKey(genre).includes(q))) return true;
    return item.type === "series" && item.seasons.some((season) => season.episodes.some((episode) => normalizeKey(`${episodeName(episode)} ${episode.title}`).includes(q)));
  });
  return `<section class="search-page">${banners()}
    <h1>Search</h1>
    <input id="search-page" type="search" placeholder="Titles, people, genres" value="${esc(query)}">
    <div class="results" data-results>${hits.length ? `<div class="grid">${hits.slice(0, 40).map((item) => card(item)).join("")}</div>` : `<p class="muted">Nothing in your library matches that.</p>`}</div>
  </section>`;
}

function listView() {
  const saved = state.items.filter((item) => state.myList.has(item.id));
  return `<section class="page">${banners()}<div class="page-head"><h1>${esc(copy().list)}</h1></div>${saved.length ? `<div class="grid">${saved.map((item) => card(item)).join("")}</div>` : `<p class="lede" style="padding:16px">Save a title and it stays on this device.</p>`}</section>`;
}

function libraryView() {
  const total = state.items.reduce((sum, item) => sum + (item.size || 0), 0);
  const files = state.items.reduce((sum, item) => sum + videoCount(item), 0);
  const matched = state.items.filter(hasDetails).length;
  const query = state.dashQuery || "";
  const titles = dashTitles(query);
  const fileRows = dashFiles(query).slice(0, 200);
  const remembered = Boolean(window.showDirectoryPicker);
  return `<section class="library">${banners()}
    <p class="eyebrow">Dashboard</p>
    <h1>${esc(state.folderName || "No folder yet")}</h1>
    <p class="note">${state.preview ? "This is a sample shelf. Choose your folder and each file name is looked up for a real poster, rating, year, and director." : "The folder is chosen once. Each file name is checked, then poster, rating, year, and director are filled only when a real match is found."} ${esc(syncLabel())}.</p>
    <p class="note warn" data-omdb ${state.omdbKeyError ? "" : "hidden"}>OMDb rejected this API key, so those details are not filled in. A title is left blank rather than given a guess.</p>
    <div class="stat-grid">
      <div class="stat"><b>${esc(state.folderName || "—")}</b><span>Folder</span></div>
      <div class="stat"><b>${movies().length}</b><span>Movies</span></div>
      <div class="stat"><b>${seriesItems().length}</b><span>Series</span></div>
      <div class="stat"><b>${files}</b><span>Video files</span></div>
      <div class="stat"><b>${esc(formatBytes(total))}</b><span>Total size</span></div>
      <div class="stat"><b data-matched>${matched}/${state.items.length}</b><span>Details found</span></div>
    </div>
    <div class="actions">
      <button class="solid" type="button" data-act="refresh">Refresh folder</button>
      <button class="ghost" type="button" data-act="choose">Change folder</button>
      <button class="ghost" type="button" data-act="forget">Remove library</button>
    </div>
    <label class="dash-filter">
      <span class="sr">Filter the dashboard</span>
      <input id="dash-filter" type="search" placeholder="Filter by title, director, or file" value="${esc(query)}" autocomplete="off">
    </label>
    <h3>Titles</h3>
    <div class="dash-scroll">
      <table class="dash-table">
        <thead><tr><th>Title</th><th>Type</th><th>Year</th><th>Director</th><th>Rating</th><th>Size</th><th>Files</th><th>Details</th></tr></thead>
        <tbody data-dash-titles>${titles.length ? titles.map(dashTitleRow).join("") : `<tr><td colspan="8">Nothing in this folder matches that.</td></tr>`}</tbody>
      </table>
    </div>
    <h3>Files</h3>
    <div class="dash-scroll">
      <table class="dash-table">
        <thead><tr><th>File</th><th>Title</th><th>Kind</th><th>Size</th></tr></thead>
        <tbody data-dash-files>${fileRows.length ? fileRows.map((row) => `<tr><td>${esc(row.path)}</td><td>${esc(shownName(row.item))}</td><td>${esc(String(row.kind || "").toUpperCase())}</td><td>${esc(formatBytes(row.size))}</td></tr>`).join("") : `<tr><td colspan="4">No video files match that.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="note">${remembered ? "This browser remembers the folder after you allow it once." : "This browser cannot remember a folder path. Choose the folder once per visit."} A typed disk path cannot be read from this page, so the folder picker is the path. Nothing here is a sample title once your folder is connected.</p>
  </section>`;
}

function paintBackdrop(node, item) {
  if (!node || !item) return;
  const image = backdropFor(item).replace(/"/g, "");
  node.style.setProperty("--hero-image", `url("${image}")`);
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
  document.querySelectorAll("[data-bg]").forEach((node) => paintBackdrop(node, findItem(state.items, node.dataset.bg)));
  if (state.keepScroll) window.scrollTo(0, y);
  else window.scrollTo(0, 0);
}

function patchItem(item) {
  document.querySelectorAll(`[data-card="${CSS.escape(item.id)}"]`).forEach((node) => {
    const image = node.querySelector("img");
    if (image) applyImage(image, item, image.dataset.wide === "1");
    const rating = node.querySelector("[data-rating]");
    if (rating) rating.innerHTML = ratingMarkup(item);
    const cap = node.querySelector(".cap");
    if (cap) cap.textContent = shownName(item);
  });
  const heroNode = document.querySelector(`[data-hero="${CSS.escape(item.id)}"]`);
  if (heroNode) {
    const desc = heroNode.querySelector("[data-desc]");
    if (desc) desc.textContent = shortText(blurb(item), 240);
    const meta = heroNode.querySelector(".hero-meta");
    if (meta) meta.innerHTML = billboardMeta(item);
  }
  if (state.route.name === "title" && state.route.id === item.id) {
    const plot = document.querySelector("[data-plot]");
    if (plot) plot.textContent = blurb(item);
    const poster = document.querySelector(".detail-poster");
    if (poster) applyImage(poster, item, false);
    const facts = document.querySelector(".detail .facts");
    if (facts) facts.innerHTML = factMarkup(item);
  }
  const dashRow = document.querySelector(`[data-dash="${CSS.escape(item.id)}"]`);
  if (dashRow) dashRow.outerHTML = dashTitleRow(item);
  const matched = document.querySelector("[data-matched]");
  if (matched) matched.textContent = `${state.items.filter(hasDetails).length}/${state.items.length}`;
  paintBackdrop(document.querySelector(`[data-bg="${CSS.escape(item.id)}"]`), item);
}

function updateScanLabel() {
  const label = document.querySelector("[data-scan]");
  if (label) label.textContent = `${state.scanCount} files found`;
  paintChrome();
}

function rememberFiles(entries) {
  const keep = state.player?.version?.filePath;
  for (const [path, url] of state.urlCache) {
    if (path !== keep) URL.revokeObjectURL(url);
  }
  const kept = keep ? state.urlCache.get(keep) : "";
  state.urlCache = new Map(kept ? [[keep, kept]] : []);
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
    if (!item.director && older.director) item.director = older.director;
    if (!item.actors && older.actors) item.actors = older.actors;
    if (!item.released && older.released) item.released = older.released;
    if (!item.rottenTomatoes && older.rottenTomatoes) item.rottenTomatoes = older.rottenTomatoes;
    if (!item.metacritic && older.metacritic) item.metacritic = older.metacritic;
    if (!item.imdbId && older.imdbId) item.imdbId = older.imdbId;
    if (!item.metaSource && older.metaSource) item.metaSource = older.metaSource;
    if (older.omdbChecked) item.omdbChecked = true;
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
  items.forEach((item, index) => enrichItem(item, onMeta, index < 6 ? 0 : 1));
}

let scanPromise = null;

async function scanHandle(handle, quiet = false) {
  if (scanPromise) return scanPromise;
  const job = runScan(handle, quiet);
  scanPromise = job;
  try {
    return await job;
  } finally {
    if (scanPromise === job) scanPromise = null;
  }
}

async function runScan(handle, quiet = false) {
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
    toast(`${BRAND} needs permission to read that folder again`);
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

async function allowFolder() {
  const handle = await idbGet("kv", "handle");
  if (handle?.requestPermission) {
    let permission = "denied";
    try { permission = await handle.requestPermission({ mode: "read" }); } catch { permission = "denied"; }
    if (permission === "granted") {
      state.permissionMode = "handle";
      state.needsPermission = false;
      await scanHandle(handle, Boolean(state.items.length));
      return;
    }
  }
  await chooseFolder();
}

async function ensurePlaybackFiles() {
  if (state.preview) return "preview";
  if (state.fileMap.size) return "ready";
  if (scanPromise) {
    await scanPromise;
    if (state.fileMap.size) return "ready";
  }
  const handle = await idbGet("kv", "handle");
  if (handle?.requestPermission) {
    let permission = "prompt";
    try { permission = await handle.queryPermission({ mode: "read" }); } catch { permission = "prompt"; }
    if (permission !== "granted") {
      try { permission = await handle.requestPermission({ mode: "read" }); } catch { permission = "denied"; }
    }
    if (permission === "granted") {
      state.permissionMode = "handle";
      state.needsPermission = false;
      await scanHandle(handle, true);
      return state.fileMap.size ? "ready" : "missing";
    }
    return "denied";
  }
  return state.fileMap.size ? "ready" : "missing";
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
  if (!confirm(`Log out of ${BRAND} on this device? Your files stay in the folder.`)) return;
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

const MIME = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

function browserCanPlay(ext) {
  const mime = MIME[String(ext || "").toLowerCase()];
  if (!mime) return false;
  const probe = document.createElement("video");
  const support = probe.canPlayType(mime);
  return support === "probably" || support === "maybe";
}

function orderedVersions(versions) {
  const playable = [];
  const rest = [];
  for (const version of versions || []) (browserCanPlay(version.ext) ? playable : rest).push(version);
  return [...playable, ...rest];
}

function playbackQueue(versions) {
  const list = (versions || []).filter(Boolean);
  const numbered = list.filter((version) => version.part);
  const partCount = new Set(numbered.map((version) => version.part)).size;
  if (partCount < 2) return orderedVersions(list);
  const groups = new Map();
  for (const version of numbered) {
    if (!groups.has(version.part)) groups.set(version.part, []);
    groups.get(version.part).push(version);
  }
  const queue = [];
  for (const part of [...groups.keys()].sort((a, b) => a - b)) queue.push(...orderedVersions(groups.get(part)));
  return queue;
}

function primaryVersion(item, episode, filePath) {
  const pools = episode?.versions?.length
    ? episode.versions
    : [...(item.versions || []), ...(item.extras || [])];
  if (filePath) {
    const found = pools.find((version) => version.filePath === filePath)
      || (item.extras || []).find((version) => version.filePath === filePath);
    if (found) return found;
  }
  return playbackQueue(pools)[0] || null;
}

function playerEpisodes(item, episode) {
  if (!episode || item?.type !== "series") return "";
  const episodes = (item.seasons || []).flatMap((season) => (season.episodes || []).map((entry) => ({ ...entry, seasonName: season.name })));
  if (episodes.length < 2) return "";
  return `<div class="player-episodes"><h3>Episodes</h3><div class="player-ep-row">${episodes.map((entry) => `<button class="player-ep${entry.id === episode.id ? " on" : ""}" type="button" data-act="play" data-id="${esc(item.id)}" data-ep="${esc(entry.id)}">
      <span class="thumb">${stillTag(entry, item)}</span>
      <span>S${entry.season} E${entry.episode || "?"} · ${esc(episodeName(entry))}</span>
    </button>`).join("")}</div></div>`;
}

function clock(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

let playbackUrl = "";
let playerToken = 0;

function closePlayer() {
  playerToken += 1;
  const root = document.getElementById("player");
  const media = state.player?.media;
  if (media) {
    try { media.pause(); } catch { /* already stopped */ }
    try {
      media.removeAttribute("src");
      media.load?.();
    } catch { /* the element is going away */ }
  }
  for (const url of state.player?.urls || []) URL.revokeObjectURL(url);
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = "";
  root.hidden = true;
  root.innerHTML = "";
  state.player = null;
}

function loadVersion(video, file, version) {
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = URL.createObjectURL(file);
  const source = document.createElement("source");
  source.src = playbackUrl;
  const mime = file.type || MIME[String(version.ext || "").toLowerCase()] || "";
  if (mime && browserCanPlay(version.ext)) source.type = mime;
  video.replaceChildren(source);
  video.load();
}

function sidecarPaths(entry, episode, item) {
  const listed = entry?.subtitlePaths?.length ? entry.subtitlePaths : (episode?.subtitlePaths || []);
  if (listed.length) return listed;
  const one = entry?.subtitlePath || episode?.subtitlePath || item?.subtitlePath;
  return one ? [one] : [];
}

function folderSubtitleRows(query) {
  const q = normalizeKey(query);
  const rows = [];
  for (const [path, file] of state.fileMap) {
    if (!/\.(srt|vtt|ass|ssa)$/i.test(path)) continue;
    if (q && !normalizeKey(path).includes(q)) continue;
    rows.push({ path, file, name: path.split("/").pop() });
    if (rows.length >= 40) break;
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function renderSubResults(query) {
  const box = document.querySelector("[data-sub-results]");
  if (!box || !state.player) return;
  const trimmed = String(query || "").trim();
  const rows = trimmed
    ? folderSubtitleRows(trimmed)
    : sidecarPaths(state.player.version, state.player.episode, state.player.item)
      .map((path) => ({ path, name: path.split("/").pop(), file: state.fileMap.get(path) }))
      .filter((row) => row.file);
  if (!rows.length) {
    box.innerHTML = `<p class="sub-empty">${trimmed ? "No subtitle in this folder matches that." : "No subtitle file is sitting beside this title. Search the folder, or upload one."}</p>`;
    return;
  }
  box.innerHTML = rows.map((row) => {
    const label = languageFromName(row.name).label;
    const on = state.player.activeSub === row.path ? " on" : "";
    return `<button type="button" class="${on}" data-act="use-sub" data-path="${esc(row.path)}">${esc(label)} · ${esc(row.name)}</button>`;
  }).join("");
}

function listedTracks(media) {
  const audio = [];
  const subs = [];
  const list = media?.audioTracks;
  if (list) {
    for (let i = 0; i < list.length; i += 1) {
      const track = list[i];
      audio.push({ index: i, label: track.label || track.language || `Audio ${i + 1}`, on: Boolean(track.enabled) });
    }
  }
  const texts = media?.textTracks;
  if (texts) {
    for (let i = 0; i < texts.length; i += 1) {
      const track = texts[i];
      if (track.kind === "metadata") continue;
      subs.push({ index: i, label: track.label || track.language || `Subtitles ${i + 1}`, on: track.mode === "showing" });
    }
  }
  const engine = Array.isArray(state.player?.engineTracks) ? state.player.engineTracks : [];
  if (audio.length < 2) {
    const found = engine.filter((track) => /audio/i.test(`${track.type || ""} ${track.kind || ""}`));
    if (found.length) {
      audio.length = 0;
      found.forEach((track, index) => audio.push({
        index,
        id: track.id,
        label: track.label || track.language || track.name || `Audio ${index + 1}`,
        on: Boolean(track.active || track.selected || track.enabled),
      }));
    }
  }
  if (!subs.length) {
    engine.filter((track) => /sub|caption|text/i.test(`${track.type || ""} ${track.kind || ""}`)).forEach((track, index) => {
      subs.push({
        index,
        id: track.id,
        label: track.label || track.language || track.name || `Subtitles ${index + 1}`,
        on: Boolean(track.active || track.selected || track.mode === "showing"),
      });
    });
  }
  return { audio, subs };
}

function paintTracks() {
  const audioBox = document.querySelector("[data-audio]");
  const subBox = document.querySelector("[data-subs]");
  if (!audioBox || !subBox || !state.player?.media) return;
  const { audio, subs } = listedTracks(state.player.media);
  audioBox.hidden = audio.length < 2;
  audioBox.innerHTML = audio.length < 2 ? "" : `<span>Audio</span>${audio.map((track) => `<button type="button" class="${track.on ? "on" : ""}" data-act="audio-track" data-index="${track.index}">${esc(track.label)}</button>`).join("")}`;
  subBox.hidden = !subs.length;
  const offOn = subs.some((track) => track.on) ? "" : "on";
  subBox.innerHTML = subs.length
    ? `<span>In this video</span><button type="button" class="${offOn}" data-act="text-track" data-index="-1">Off</button>${subs.map((track) => `<button type="button" class="${track.on ? "on" : ""}" data-act="text-track" data-index="${track.index}">${esc(track.label)}</button>`).join("")}`
    : "";
}

async function openPlayer(item, episode, version) {
  if (state.preview) {
    toast("This is a sample layout. Add your folder to play the movies and series on this device.");
    return;
  }
  const pool = episode?.versions?.length ? episode.versions : [...(item.versions || []), ...(item.extras || [])];
  const queue = playbackQueue(pool.length ? pool : [version]);
  const start = Math.max(0, queue.findIndex((entry) => entry.filePath === version.filePath));
  const versions = queue.length ? queue.slice(start) : [version];
  const access = await ensurePlaybackFiles();
  if (access !== "ready") {
    if (access === "missing") {
      toast("Add the folder once. Every movie and series in it plays after that, without asking for a path again.");
      await chooseFolder();
    } else if (access !== "preview") {
      toast("Allow the folder once. After that, every title in it plays without asking again.");
    }
  }
  if (!versions.some((entry) => state.fileMap.has(entry.filePath))) {
    if (access === "ready") toast("That file is no longer in the folder.");
    return;
  }
  const token = ++playerToken;
  const root = document.getElementById("player");
  const title = episode ? `${shownName(item)} · ${episodeName(episode)}` : shownName(item);
  root.classList.toggle("has-episodes", Boolean(episode));
  root.innerHTML = `<div class="player-top"><button type="button" data-act="close-player">Close</button><strong>${esc(title)}</strong><span data-quality></span></div>
    <div class="stage"></div>
    ${playerEpisodes(item, episode)}
    <p class="player-note">Opening the file…</p>
    <div class="controls">
      <button type="button" data-act="toggle">${esc(copy().play)}</button>
      <button type="button" data-act="back10">-10s</button>
      <input class="seek" type="range" min="0" max="1000" value="0" aria-label="Seek">
      <span class="time">0:00</span>
      <button type="button" data-act="fwd10">+10s</button>
      <button type="button" data-act="full">Full</button>
    </div>
    <div class="sub-tools">
      <div class="track-row" data-audio hidden></div>
      <div class="track-row" data-subs hidden></div>
      <div class="sub-search-row">
        <input id="sub-search" type="search" placeholder="Search subtitles in your folder" autocomplete="off">
        <button type="button" data-act="upload-sub">Upload subtitle</button>
      </div>
      <div class="sub-list" data-sub-results></div>
    </div>`;
  root.hidden = false;
  const stage = root.querySelector(".stage");
  const note = root.querySelector(".player-note");
  const seek = root.querySelector(".seek");
  const time = root.querySelector(".time");
  const toggle = root.querySelector("[data-act='toggle']");
  const quality = root.querySelector("[data-quality]");
  const controls = root.querySelector(".controls");
  let index = 0;
  let failed = false;
  state.player = {
    item,
    episode,
    version: versions[0],
    media: null,
    video: null,
    urls: [],
    engineTracks: [],
    activeSub: "",
  };
  openPlayer.savedAt = 0;

  const showFailure = () => {
    note.hidden = false;
    note.textContent = "This copy could not play in this browser. If the folder has another copy of the same title, that one is tried next.";
  };
  const rememberProgress = (media, entry, force) => {
    if (!entry || token !== playerToken) return;
    const current = Number(media.currentTime) || 0;
    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    if (!force && (current < 1 || Date.now() - openPlayer.savedAt < 4000)) return;
    openPlayer.savedAt = Date.now();
    const row = { path: entry.filePath, time: current, duration, updated: Date.now() };
    state.progress.set(entry.filePath, row);
    idbSet("progress", entry.filePath, row);
  };
  const selectAudio = (trackIndex) => {
    const media = state.player?.media;
    if (!media) return;
    const list = media.audioTracks;
    if (list && list.length > trackIndex) {
      for (let i = 0; i < list.length; i += 1) list[i].enabled = i === trackIndex;
      paintTracks();
      return;
    }
    const tracks = (state.player.engineTracks || []).filter((track) => /audio/i.test(`${track.type || ""} ${track.kind || ""}`));
    const api = media.player || media;
    if (tracks[trackIndex] && typeof api.setAudioTrack === "function") api.setAudioTrack(tracks[trackIndex].id ?? trackIndex);
    paintTracks();
  };
  const selectText = (trackIndex) => {
    const media = state.player?.media;
    if (!media) return;
    const texts = media.textTracks;
    if (texts && texts.length) {
      for (let i = 0; i < texts.length; i += 1) {
        if (texts[i].kind === "metadata") continue;
        texts[i].mode = i === trackIndex ? "showing" : "disabled";
      }
    }
    const api = media.player || media;
    if (typeof api.setSubtitleTrack === "function") {
      if (trackIndex < 0) api.setSubtitleTrack(null);
      else {
        const tracks = (state.player.engineTracks || []).filter((track) => /sub|caption|text/i.test(`${track.type || ""} ${track.kind || ""}`));
        if (tracks[trackIndex]) api.setSubtitleTrack(tracks[trackIndex].id ?? trackIndex);
      }
    }
    paintTracks();
  };
  const addSubtitle = async (file, path) => {
    const media = state.player?.media;
    if (!file || token !== playerToken) return;
    if (!media) {
      state.player.pendingSub = { file, path };
      return;
    }
    const name = path || file.name || "subtitle.vtt";
    const spoken = languageFromName(name);
    try {
      const vtt = await vttFile(file);
      const api = typeof media.addSubtitleFile === "function" ? media : media.player;
      if (api && typeof api.addSubtitleFile === "function") await api.addSubtitleFile(vtt);
      else {
        const url = URL.createObjectURL(vtt);
        state.player.urls.push(url);
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.label = spoken.label;
        track.srclang = spoken.code;
        track.default = true;
        track.src = url;
        media.appendChild(track);
        if (track.track) track.track.mode = "showing";
      }
      state.player.activeSub = path || name;
      paintTracks();
      renderSubResults(document.getElementById("sub-search")?.value || "");
    } catch (error) {
      console.error(error);
      toast("That subtitle could not be read.");
    }
  };
  state.player.selectAudio = selectAudio;
  state.player.selectText = selectText;
  state.player.addSubtitle = addSubtitle;

  const goNext = () => {
    if (failed || token !== playerToken) return;
    failed = true;
    index += 1;
    if (index < versions.length) startVersion();
    else showFailure();
  };
  const wireMedia = (media, entry) => {
    let attached = false;
    const attachDefault = () => {
      if (attached || token !== playerToken) return;
      attached = true;
      const path = sidecarPaths(entry, episode, item)[0];
      const file = path ? state.fileMap.get(path) : null;
      if (file) addSubtitle(file, path);
      else renderSubResults("");
    };
    media.addEventListener("timeupdate", () => {
      if (token !== playerToken) return;
      const duration = Number.isFinite(media.duration) ? media.duration : 0;
      const current = Number(media.currentTime) || 0;
      if (duration && seek) seek.value = String(Math.round((current / duration) * 1000));
      if (time) time.textContent = `${clock(current)} / ${clock(duration)}`;
      rememberProgress(media, state.player?.version, false);
    });
    media.addEventListener("pause", () => {
      if (toggle) toggle.textContent = copy().play;
      rememberProgress(media, state.player?.version, true);
    });
    media.addEventListener("playing", () => {
      if (token !== playerToken) return;
      note.hidden = true;
      if (toggle) toggle.textContent = "Pause";
      attachDefault();
      paintTracks();
    });
    media.addEventListener("loadedmetadata", () => {
      attachDefault();
      paintTracks();
      const saved = state.progress.get(entry.filePath);
      if (saved?.time > 1 && Number.isFinite(media.duration) && saved.time < media.duration - 5 && media.tagName === "VIDEO") {
        try { media.currentTime = saved.time; } catch { /* keep the start */ }
      }
    });
    media.addEventListener("trackschange", (event) => {
      if (Array.isArray(event.detail)) state.player.engineTracks = event.detail;
      paintTracks();
    });
    media.addEventListener("audiotrackchange", () => paintTracks());
    media.addEventListener("subtitletrackchange", () => paintTracks());
    media.textTracks?.addEventListener?.("addtrack", () => paintTracks());
    media.audioTracks?.addEventListener?.("addtrack", () => paintTracks());
    media.addEventListener("ended", () => {
      if (token !== playerToken) return;
      const current = state.player?.version;
      if (current?.part) {
        const nextPart = versions.findIndex((entry, entryIndex) => entryIndex > index && entry.part && entry.part > current.part);
        if (nextPart >= 0 && state.fileMap.has(versions[nextPart].filePath)) {
          index = nextPart;
          failed = false;
          startVersion();
          return;
        }
      }
      const next = nextEpisode(item, episode);
      const nextVersion = playbackQueue(next?.versions)[0];
      if (next && nextVersion && state.fileMap.has(nextVersion.filePath)) openPlayer(item, next, nextVersion);
    });
    if (media.tagName === "VIDEO") {
      media.addEventListener("error", async () => {
        if (token !== playerToken || failed || media.dataset.handed === "1") return;
        media.dataset.handed = "1";
        const file = state.fileMap.get(entry.filePath);
        if (file) {
          note.hidden = false;
          note.textContent = "Trying the full player for this file…";
          const opened = await playMovi(file, entry);
          if (opened) return;
        }
        goNext();
      });
    } else {
      media.addEventListener("filerevoked", () => {
        state.fileMap = new Map();
        state.needsPermission = true;
        toast("The browser closed the folder. Allow it once, and every title plays again.");
        render();
      });
      const openedAt = Date.now();
      media.addEventListener("errordisplay", (event) => {
        const detail = event.detail || {};
        if (detail.canRetry || detail.canTrySoftware) return;
        if (Date.now() - openedAt < 1500) return;
        goNext();
      });
    }
  };
  const playMovi = async (file, entry) => {
    if (token !== playerToken) return false;
    try {
      await loadMovi();
    } catch (error) {
      console.error(error);
      return false;
    }
    if (token !== playerToken) return false;
    const el = document.createElement("movi-player");
    el.controls = true;
    el.playsinline = true;
    el.fallback = "native";
    el.engine = "wasm native";
    el.wasmurl = moviWasmUrl();
    el.subtitlepicker = true;
    el.nolinkwarning = true;
    el.themecolor = "#e50914";
    el.title = title;
    const saved = state.progress.get(entry.filePath);
    if (saved?.time > 1) el.startat = saved.time;
    controls.hidden = true;
    stage.replaceChildren(el);
    state.player.media = el;
    state.player.video = el;
    state.player.version = entry;
    wireMedia(el, entry);
    if (state.player.pendingSub) {
      const pending = state.player.pendingSub;
      state.player.pendingSub = null;
      addSubtitle(pending.file, pending.path);
    }
    el.src = file;
    try { await el.play(); } catch { /* the player controls stay on screen */ }
    return true;
  };
  const playNative = (file, entry) => {
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    controls.hidden = false;
    stage.replaceChildren(video);
    state.player.media = video;
    state.player.video = video;
    state.player.version = entry;
    wireMedia(video, entry);
    if (state.player.pendingSub) {
      const pending = state.player.pendingSub;
      state.player.pendingSub = null;
      addSubtitle(pending.file, pending.path);
    }
    loadVersion(video, file, entry);
    video.play().catch(() => {});
  };
  const startVersion = async () => {
    if (token !== playerToken) return;
    failed = false;
    const entry = versions[index];
    const file = entry ? state.fileMap.get(entry.filePath) : null;
    if (!entry || !file) {
      index += 1;
      if (index < versions.length) return startVersion();
      showFailure();
      return;
    }
    state.player.version = entry;
    quality.textContent = `${entry.part ? `Part ${entry.part} · ` : ""}${entry.quality || String(entry.ext || "").toUpperCase()} · ${formatBytes(entry.size)}`;
    note.hidden = false;
    note.textContent = index ? "That copy could not play. Opening another…" : "Opening the file…";
    renderSubResults(document.getElementById("sub-search")?.value || "");
    const demux = await fileWantsDemux(file, entry.ext);
    if (token !== playerToken) return;
    if (demux) {
      const opened = await playMovi(file, entry);
      if (!opened) goNext();
      return;
    }
    playNative(file, entry);
  };
  await startVersion();
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
  const hits = !query ? state.items : state.items.filter((item) => normalizeKey(`${shownName(item)} ${item.title} ${(item.genres || []).join(" ")}`).includes(query) || (item.type === "series" && item.seasons.some((season) => season.episodes.some((episode) => normalizeKey(`${episodeName(episode)} ${episode.title}`).includes(query)))));
  box.innerHTML = hits.length ? `<div class="grid">${hits.slice(0, 40).map((item) => card(item)).join("")}</div>` : `<p class="muted">Nothing in your library matches that.</p>`;
}

async function onClick(event) {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (act === "faq") {
    const panel = button.nextElementSibling;
    if (!panel) return;
    const open = panel.hasAttribute("hidden");
    panel.toggleAttribute("hidden", !open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    const mark = button.querySelector(".faq-mark");
    if (mark) mark.textContent = open ? "–" : "+";
    button.classList.toggle("open", open);
    return;
  }
  if (act === "row-scroll") {
    const scroller = button.parentElement?.querySelector(".scroller");
    if (scroller) scroller.scrollBy({ left: Number(button.dataset.dir || 1) * scroller.clientWidth * 0.85, behavior: "smooth" });
    return;
  }
  if (act === "hero-slide") {
    const slider = button.closest("[data-slider]");
    if (!slider) return;
    const slides = [...slider.querySelectorAll("[data-slide]")];
    const current = slides.findIndex((node) => node.classList.contains("on"));
    const next = button.dataset.index != null
      ? Number(button.dataset.index)
      : (current + Number(button.dataset.dir || 1) + slides.length) % slides.length;
    slides.forEach((node, index) => node.classList.toggle("on", index === next));
    slider.querySelectorAll("[data-dot]").forEach((node, index) => node.classList.toggle("on", index === next));
    return;
  }
  if (act === "choose") return chooseFolder();
  if (act === "allow") return allowFolder();
  if (act === "refresh") return refreshLibrary();
  if (act === "forget" || act === "logout") return forgetFolder();
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
    const on = state.myList.has(id);
    const text = on ? copy().listOn : copy().listAdd;
    const label = button.querySelector("[data-list-label]");
    if (label) label.textContent = text;
    else if (button.classList.contains("icon-round")) {
      button.setAttribute("aria-label", text);
      button.innerHTML = on ? checkIcon : plusIcon;
    } else button.textContent = text;
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
  if (act === "upload-sub") {
    document.getElementById("sub-file").click();
    return;
  }
  if (!state.player) return;
  if (act === "use-sub") {
    const file = state.fileMap.get(button.dataset.path);
    if (file) await state.player.addSubtitle(file, button.dataset.path);
    return;
  }
  if (act === "audio-track") {
    state.player.selectAudio(Number(button.dataset.index));
    return;
  }
  if (act === "text-track") {
    state.player.selectText(Number(button.dataset.index));
    return;
  }
  const video = state.player.video;
  if (!video) return;
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
    state.items = polishLibrary(catalog.items);
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
      state.items.forEach((item, index) => enrichItem(item, onMeta, index < 6 ? 0 : 1));
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
    if (event.target.id === "dash-filter") {
      state.dashQuery = event.target.value;
      const titles = document.querySelector("[data-dash-titles]");
      const files = document.querySelector("[data-dash-files]");
      const found = dashTitles(state.dashQuery);
      const fileRows = dashFiles(state.dashQuery).slice(0, 200);
      if (titles) titles.innerHTML = found.length ? found.map(dashTitleRow).join("") : `<tr><td colspan="8">Nothing in this folder matches that.</td></tr>`;
      if (files) files.innerHTML = fileRows.length ? fileRows.map((row) => `<tr><td>${esc(row.path)}</td><td>${esc(shownName(row.item))}</td><td>${esc(String(row.kind || "").toUpperCase())}</td><td>${esc(formatBytes(row.size))}</td></tr>`).join("") : `<tr><td colspan="4">No video files match that.</td></tr>`;
      return;
    }
    if (event.target.id === "sub-search") {
      renderSubResults(event.target.value);
      return;
    }
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
  document.getElementById("sub-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !state.player?.addSubtitle) return;
    await state.player.addSubtitle(file, file.name);
  });
  document.body.addEventListener("error", (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallback === "1") return;
    const alts = (img.dataset.alts || "").split("|").filter(Boolean);
    if (alts.length) {
      const next = alts.shift();
      img.dataset.alts = alts.join("|");
      if (next.startsWith("data:")) img.dataset.fallback = "1";
      img.src = next;
      return;
    }
    if (img.dataset.tried !== "1") {
      img.dataset.tried = "1";
      const title = img.dataset.show || img.alt;
      remotePoster(title, img.dataset.year, img.dataset.kind).then((url) => {
        if (url && img.dataset.fallback !== "1") {
          img.src = url;
          return;
        }
        img.dataset.fallback = "1";
        img.src = artwork(img.alt || title || "Title", img.dataset.year || "", img.dataset.wide === "1");
      });
      return;
    }
    img.dataset.fallback = "1";
    img.src = artwork(img.alt || img.dataset.show || "Title", img.dataset.year || "", img.dataset.wide === "1");
  }, true);
  setInterval(() => {
    const slider = document.querySelector("[data-slider]");
    if (!slider || document.hidden || slider.matches(":hover")) return;
    const slides = [...slider.querySelectorAll("[data-slide]")];
    if (slides.length < 2) return;
    const current = slides.findIndex((node) => node.classList.contains("on"));
    const next = (current + 1) % slides.length;
    slides.forEach((node, index) => node.classList.toggle("on", index === next));
    slider.querySelectorAll("[data-dot]").forEach((node, index) => node.classList.toggle("on", index === next));
  }, 8000);
  window.addEventListener("scroll", () => {
    document.body.classList.toggle("scrolled", window.scrollY > 8);
  }, { passive: true });
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
    if (state.player.media?.tagName === "MOVI-PLAYER") return;
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
