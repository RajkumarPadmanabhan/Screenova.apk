import { idbGet, idbSet } from "./db.js";
import { normalizeKey, titleScore } from "./library.js";

const jobs = [];
let active = 0;

function enqueue(task, priority = 1) {
  return new Promise((resolve, reject) => {
    jobs.push({ task, priority, resolve, reject });
    jobs.sort((a, b) => a.priority - b.priority);
    pump();
  });
}

function pump() {
  while (active < 2 && jobs.length) {
    const job = jobs.shift();
    active += 1;
    job.task()
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        setTimeout(pump, 180);
      });
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(item) {
  return `${item.type}:${item.title.toLowerCase()}:${item.year || ""}`;
}

function yearsClash(itemYear, remoteYear) {
  if (!itemYear || !remoteYear) return false;
  return Math.abs(Number(itemYear) - Number(remoteYear)) > 1;
}

function acceptable(title, year, item) {
  if (yearsClash(item.year, year)) return false;
  if (titleScore(title, item.title) >= 0.8) return true;
  const noise = new Set(["film", "movie", "series", "tv", "show", "television", "season"]);
  const remote = normalizeKey(title).split(" ").filter((token) => token && token !== "the" && token !== "a" && !noise.has(token));
  const local = normalizeKey(item.title).split(" ").filter((token) => token && token !== "the" && token !== "a");
  return remote.join(" ") === local.join(" ") && local.length > 0;
}

function parseRuntime(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value > 400 ? value : Math.round(value * 60);
  const text = String(value || "");
  const minutes = text.match(/(\d+)\s*min/i);
  if (minutes) return Number(minutes[1]) * 60;
  const clock = text.match(/(\d+)\s*h(?:\s*(\d+))?/i);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2] || 0) * 60;
  return null;
}

async function fromTvMaze(item) {
  const results = await fetchJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(item.title)}`);
  const match = (results || [])
    .map((entry) => entry.show)
    .find((show) => acceptable(show?.name, Number(show?.premiered?.slice(0, 4)) || null, item));
  if (!match) return null;
  const episodes = await fetchJson(`https://api.tvmaze.com/shows/${match.id}/episodes`);
  return {
    source: "TVmaze",
    title: match.name,
    year: Number(match.premiered?.slice(0, 4)) || null,
    rating: match.rating?.average || null,
    imdb: false,
    description: stripHtml(match.summary),
    genres: match.genres || [],
    posterUrl: match.image?.original || match.image?.medium || "",
    backdropUrl: "",
    runtime: match.runtime ? match.runtime * 60 : null,
    episodes: (episodes || []).map((episode) => ({
      season: episode.season,
      episode: episode.number,
      title: episode.name || "",
      description: stripHtml(episode.summary),
      stillUrl: episode.image?.original || episode.image?.medium || "",
      runtime: episode.runtime ? episode.runtime * 60 : null,
    })),
  };
}

async function fromCinemeta(item) {
  const type = item.type === "series" ? "series" : "movie";
  const search = await fetchJson(`https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(item.title)}.json`);
  const hit = (search?.metas || []).find((meta) => acceptable(meta.name, Number(String(meta.year || meta.releaseInfo || "").slice(0, 4)) || null, item));
  if (!hit?.id) return null;
  const full = await fetchJson(`https://v3-cinemeta.strem.io/meta/${type}/${hit.id}.json`);
  const meta = full?.meta || hit;
  const year = Number(String(meta.year || meta.releaseInfo || "").slice(0, 4)) || null;
  if (!acceptable(meta.name, year, item)) return null;
  return {
    source: "public metadata",
    title: meta.name,
    year,
    rating: Number(meta.imdbRating) || null,
    imdb: Boolean(meta.imdbRating),
    description: stripHtml(meta.description),
    genres: meta.genre || meta.genres || [],
    posterUrl: meta.poster || hit.poster || "",
    backdropUrl: meta.background || hit.background || "",
    runtime: parseRuntime(meta.runtime),
    episodes: (meta.videos || []).map((video) => ({
      season: video.season,
      episode: video.episode || video.number,
      title: video.title || video.name || "",
      description: stripHtml(video.overview || video.description),
      stillUrl: video.thumbnail || "",
      runtime: parseRuntime(video.runtime),
    })),
  };
}

async function fromWikipedia(item) {
  const hint = item.type === "series" ? "television series" : "film";
  const data = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(`${item.title} ${hint} ${item.year || ""}`)}&gsrlimit=4&prop=pageimages|extracts&exintro=1&explaintext=1&exchars=460&piprop=thumbnail|original&pithumbsize=900`);
  const pages = Object.values(data?.query?.pages || {});
  const page = pages.find((entry) => acceptable(entry.title, item.year, item)) || pages.find((entry) => titleScore(entry.title, item.title) >= 0.8);
  if (!page?.extract) return null;
  return {
    source: "Wikipedia",
    title: page.title,
    year: item.year,
    rating: null,
    imdb: false,
    description: page.extract,
    genres: [],
    posterUrl: page.original?.source || page.thumbnail?.source || "",
    backdropUrl: "",
    runtime: null,
    episodes: [],
  };
}

async function lookup(item) {
  if (item.type === "series") {
    const show = await fromTvMaze(item);
    if (show?.description || show?.posterUrl) {
      if (!show.backdropUrl || !show.rating) {
        const extra = await fromCinemeta(item);
        if (extra) {
          show.backdropUrl = show.backdropUrl || extra.backdropUrl;
          show.posterUrl = show.posterUrl || extra.posterUrl;
          show.rating = show.rating || extra.rating;
          show.imdb = show.imdb || extra.imdb;
          show.description = show.description || extra.description;
          show.genres = show.genres?.length ? show.genres : extra.genres;
          if (!show.episodes?.length) show.episodes = extra.episodes;
        }
      }
      return show;
    }
  }
  const movie = await fromCinemeta(item);
  if (movie?.description || movie?.posterUrl || movie?.rating) return movie;
  return fromWikipedia(item);
}

function genericEpisodeTitle(title) {
  return !title || /^(episode\s+\d+|extra)$/i.test(title);
}

export function applyMeta(item, meta) {
  if (!meta) return false;
  let changed = false;
  const fill = (key, value) => {
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
    if (item[key] == null || item[key] === "" || (Array.isArray(item[key]) && !item[key].length)) {
      item[key] = value;
      changed = true;
    }
  };
  if (!item.description || item.description.length < 40) fill("description", meta.description);
  if (!item.rating && meta.rating) {
    item.rating = meta.rating;
    item.imdb = Boolean(meta.imdb);
    changed = true;
  }
  if (!item.posterPath) fill("posterUrl", meta.posterUrl);
  if (!item.backdropPath) fill("backdropUrl", meta.backdropUrl);
  if (!item.year) fill("year", meta.year);
  if (!item.duration && item.type === "movie") fill("duration", meta.runtime);
  if (!(item.genres || []).length && meta.genres?.length) {
    item.genres = [...meta.genres];
    changed = true;
  }
  if (item.type === "series" && meta.episodes?.length) {
    for (const season of item.seasons || []) {
      for (const episode of season.episodes) {
        const remote = meta.episodes.find((entry) => entry.season === episode.season && entry.episode === episode.episode);
        if (!remote) continue;
        if (genericEpisodeTitle(episode.title) && remote.title) {
          episode.title = remote.title;
          changed = true;
        }
        if (!episode.description && remote.description) {
          episode.description = remote.description;
          changed = true;
        }
        if (!episode.stillPath && remote.stillUrl) {
          episode.stillUrl = remote.stillUrl;
          changed = true;
        }
        if (!episode.duration && remote.runtime) {
          episode.duration = remote.runtime;
          changed = true;
        }
      }
    }
  }
  if (changed) {
    item.credits = [...new Set([...(item.credits || []), meta.source].filter(Boolean))];
  }
  return changed;
}

function needsEnrichment(item) {
  if (!item.rating || !item.description || !(item.posterPath || item.posterUrl)) return true;
  if (item.type !== "series") return false;
  return (item.seasons || []).some((season) => season.episodes.some((episode) => !episode.description || /^(episode\s+\d+|extra)$/i.test(episode.title || "")));
}

export function enrichItem(item, onUpdate, priority = 1) {
  if (!needsEnrichment(item)) return Promise.resolve(false);
  return enqueue(async () => {
    const key = cacheKey(item);
    const cached = await idbGet("meta", key);
    const fresh = cached && Date.now() - cached.at < 1000 * 60 * 60 * 24 * 21;
    let meta = fresh ? cached.data : null;
    if (!fresh) {
      meta = await lookup(item);
      await idbSet("meta", key, { at: Date.now(), data: meta });
    }
    const changed = applyMeta(item, meta);
    if (changed && onUpdate) onUpdate(item);
    return changed;
  }, priority);
}
