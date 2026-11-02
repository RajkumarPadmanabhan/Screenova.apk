const VIDEO_EXT = new Set(["mp4", "mkv", "avi", "webm", "m4v", "mov", "mpg", "mpeg", "wmv", "flv", "ts", "m2ts", "vob", "ogv", "ogg", "3gp", "m2v"]);
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);
const SUB_EXT = new Set(["srt", "vtt", "ass", "ssa"]);
const PLAYABLE = new Set(["mp4", "webm", "m4v", "mov", "ogv", "ogg"]);

const COLLECTION = /^(movies?|films?|cinema|series|tv|tv[\s._-]?shows?|shows?|television|videos?|downloads?|media|library|entertainment)$/i;

const GENRE_ALIAS = new Map([
  ["action", "Action"],
  ["adventure", "Adventure"],
  ["animation", "Animation"],
  ["anime", "Anime"],
  ["biography", "Biography"],
  ["comedy", "Comedy"],
  ["crime", "Crime"],
  ["documentary", "Documentary"],
  ["documentaries", "Documentary"],
  ["drama", "Drama"],
  ["family", "Family"],
  ["fantasy", "Fantasy"],
  ["history", "History"],
  ["horror", "Horror"],
  ["music", "Music"],
  ["musical", "Musical"],
  ["mystery", "Mystery"],
  ["romance", "Romance"],
  ["romantic", "Romance"],
  ["sci fi", "Sci-Fi"],
  ["scifi", "Sci-Fi"],
  ["science fiction", "Sci-Fi"],
  ["sport", "Sport"],
  ["sports", "Sport"],
  ["thriller", "Thriller"],
  ["war", "War"],
  ["western", "Western"],
  ["kids", "Kids"],
]);

export function extOf(name) {
  const value = String(name || "");
  const index = value.lastIndexOf(".");
  return index >= 0 ? value.slice(index + 1).toLowerCase() : "";
}

export function kindOf(name) {
  const ext = extOf(name);
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === "nfo" || ext === "xml") return "nfo";
  if (SUB_EXT.has(ext)) return "subtitle";
  return "other";
}

export function playableExt(ext) {
  return PLAYABLE.has(String(ext || "").toLowerCase());
}

export function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function coreTokens(tokens) {
  const skip = new Set(["the", "a", "an"]);
  const core = tokens.filter((token) => !skip.has(token));
  return core.length ? core : tokens;
}

export function titleScore(a, b) {
  const left = normalizeKey(a);
  const right = normalizeKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const aTokens = left.split(" ").filter(Boolean);
  const bTokens = right.split(" ").filter(Boolean);
  const aCore = coreTokens(aTokens);
  const bCore = coreTokens(bTokens);
  if (aCore.join(" ") === bCore.join(" ")) return 1;
  const aSet = new Set(aCore);
  const bSet = new Set(bCore);
  let shared = 0;
  for (const token of aSet) if (bSet.has(token)) shared += 1;
  const overlap = shared / Math.max(aSet.size, bSet.size);
  const shorter = aCore.length <= bCore.length ? aCore : bCore;
  const longer = aCore.length > bCore.length ? aCore.join(" ") : bCore.join(" ");
  if (shorter.length >= 2 && shared === shorter.length && longer.includes(shorter.join(" "))) return Math.max(overlap, 0.9);
  return overlap;
}

export function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  const gb = 1024 ** 3;
  const mb = 1024 ** 2;
  if (size >= gb) return `${(size / gb).toFixed(size >= 10 * gb ? 0 : 1)} GB`;
  if (size >= mb) return `${Math.max(1, Math.round(size / mb))} MB`;
  if (size >= 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${size} B`;
}

export function formatDuration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  if (!total) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function shortText(text, max = 180) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function parseNfo(text) {
  if (!text) return null;
  const source = String(text);
  const grab = (tag) => {
    const match = source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    return match ? decodeXml(match[1]) : "";
  };
  const grabAll = (tag) => [...source.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))]
    .map((match) => decodeXml(match[1]))
    .filter(Boolean);
  let rating = Number.parseFloat(grab("rating") || grab("value"));
  if (Number.isFinite(rating) && rating > 10) rating /= 10;
  if (!Number.isFinite(rating) || rating <= 0 || rating > 10) rating = null;
  const runtime = Number.parseFloat(grab("runtime"));
  const premiered = grab("premiered").match(/^(19|20)\d{2}/);
  const year = Number.parseInt(grab("year") || (premiered ? premiered[0] : ""), 10);
  return {
    title: grab("title"),
    plot: grab("plot") || grab("overview") || grab("outline"),
    year: Number.isFinite(year) ? year : null,
    rating,
    genres: [...new Set(grabAll("genre").flatMap((genre) => genre.split(/[|,/]/)).map((genre) => genre.trim()).filter(Boolean))],
    runtime: Number.isFinite(runtime) && runtime > 0 ? runtime : null,
  };
}

function extractYear(value) {
  const text = String(value || "");
  const wrapped = [...text.matchAll(/\(((?:19|20)\d{2})\)/g)].pop();
  if (wrapped) return Number(wrapped[1]);
  const years = [...text.matchAll(/(?:^|[.\s_\-[\]])((?:19|20)\d{2})(?=[.\s_\-\]]|$)/g)];
  return years.length ? Number(years[years.length - 1][1]) : null;
}

function stripYear(value, year) {
  if (!year) return String(value || "");
  const pattern = new RegExp(`\\(${year}\\)|(?:^|[.\\s_\\-\\[])${year}(?=[.\\s_\\-\\]]|$)`);
  return String(value || "").replace(pattern, " ");
}

function stripReleaseTags(value) {
  return String(value || "")
    .replace(/[._]+/g, " ")
    .replace(/\[.*?\]/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(2160p|1080p|720p|480p|576p|4k|uhd|hdr10|hdr|sdr)\b/gi, " ")
    .replace(/\b(bluray|blu ray|bdrip|brrip|webrip|web dl|webdl|hdrip|dvdrip|hdtv|remux|proper|repack|extended|unrated|directors cut|imax|amzn|nf|dsnp|hmax|atvp)\b/gi, " ")
    .replace(/\b(x264|x265|h264|h265|hevc|avc|xvid|divx)\b/gi, " ")
    .replace(/\b(ddp|dd|dts|truehd|atmos|aac|flac|eac3|ac3|mp3)\s?\d?(?:\.\d)?\b/gi, " ")
    .replace(/\b(10bit|8bit|hi10p)\b/gi, " ")
    .replace(/\b(complete|multi|dual audio|subbed|dubbed)\b/gi, " ")
    .replace(/[-–—]\s*[A-Za-z0-9]{2,}$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeakTitle(title) {
  return !title || /^(episode|ep|part|chapter|video|movie|e|disc|cd)?\s*\d{0,3}$/i.test(title);
}

export function parseRelease(filename) {
  const base = String(filename || "").replace(/\.[^.]+$/, "");
  const year = extractYear(base);
  const working = stripYear(base, year);
  let season = null;
  let episode = null;
  let showPart = working;
  let episodePart = "";
  const episodeMatch = working.match(/(?:^|[.\s_-])S(\d{1,2})[.\s_-]*E(\d{1,3})(?=[.\s_-]|$)/i)
    || working.match(/(?:^|[.\s_-])(\d{1,2})x(\d{2,3})(?=[.\s_-]|$)/i);
  if (episodeMatch) {
    season = Number(episodeMatch[1]);
    episode = Number(episodeMatch[2]);
    showPart = working.slice(0, episodeMatch.index);
    episodePart = working.slice(episodeMatch.index + episodeMatch[0].length);
  } else {
    const only = working.match(/^E(?:pisode)?[.\s_-]*(\d{1,3})$/i);
    if (only) episode = Number(only[1]);
  }
  let title = stripReleaseTags(showPart).replace(/\b(us|uk|au)$/i, "").trim();
  let episodeTitle = stripReleaseTags(episodePart);
  if (isWeakTitle(title)) title = "";
  if (!episodeTitle || isWeakTitle(episodeTitle) || normalizeKey(episodeTitle) === normalizeKey(title)) episodeTitle = "";
  const qualityMatch = base.match(/\b(2160p|1080p|720p|480p|4k|uhd)\b/i);
  let quality = "";
  if (qualityMatch) {
    quality = /4k|uhd|2160p/i.test(qualityMatch[1]) ? "4K" : qualityMatch[1].toLowerCase();
  }
  return { title, year, season, episode, episodeTitle, quality };
}

function classifyFolder(name) {
  const season = name.match(/^season[\s._-]*(\d{1,2})$/i) || name.match(/^s(\d{1,2})$/i);
  if (season) return { role: "season", season: Number(season[1]), raw: name };
  if (/^specials?$/i.test(name)) return { role: "season", season: 0, raw: name };
  if (COLLECTION.test(name)) return { role: "collection", raw: name };
  if (/^(extras?|featurettes?|deleted[\s._-]?scenes?|behind[\s._-]?the[\s._-]?scenes?|interviews?|trailers?|samples?|subs|subtitles)$/i.test(name)) {
    return { role: "extras", raw: name };
  }
  const genre = GENRE_ALIAS.get(normalizeKey(name));
  if (genre) return { role: "genre", genre, raw: name };
  const parsed = parseRelease(name);
  return { role: "title", raw: name, title: parsed.title || stripReleaseTags(name), year: parsed.year };
}

function analyze(relativePath) {
  const parts = String(relativePath || "").split("/").filter(Boolean);
  const name = parts.pop() || "";
  return { name, parts, folders: parts.map(classifyFolder), dir: parts.join("/") };
}

function junkPath(folders) {
  return folders.some((folder) => /^(video_ts|bdmv|certificate|\$recycle\.bin|@eadir|node_modules)$/i.test(folder.raw));
}

function isSample(name, size) {
  return /\bsample\b/i.test(name) && (size || 0) < 80 * 1024 * 1024;
}

function dirOf(relativePath) {
  const parts = String(relativePath || "").split("/");
  parts.pop();
  return parts.join("/");
}

function findNamedImage(images, dir, names) {
  const wanted = new Set(names.filter(Boolean).map((name) => name.toLowerCase()));
  const hit = images.find((image) => dirOf(image.relativePath) === dir && wanted.has(image.name.replace(/\.[^.]+$/, "").toLowerCase()));
  return hit ? hit.relativePath : null;
}

function videoRecord(entry) {
  const info = analyze(entry.relativePath);
  if (junkPath(info.folders) || isSample(info.name, entry.size || 0)) return null;
  const parsed = parseRelease(info.name);
  const seasonFolder = [...info.folders].reverse().find((folder) => folder.role === "season");
  const titleFolder = [...info.folders].reverse().find((folder) => folder.role === "title");
  const inExtras = info.folders.some((folder) => folder.role === "extras");
  let season = parsed.season;
  let episode = parsed.episode;
  let episodeTitle = parsed.episodeTitle;
  if (season == null && seasonFolder) season = seasonFolder.season;
  if (seasonFolder && episode == null) {
    const loose = info.name.replace(/\.[^.]+$/, "").match(/^(\d{1,3})(?:[.\s_-]+(.+))?$/);
    if (loose) {
      episode = Number(loose[1]);
      episodeTitle = episodeTitle || stripReleaseTags(loose[2] || "");
    }
  }
  let showDir = null;
  if (titleFolder) {
    const index = info.folders.indexOf(titleFolder);
    showDir = info.parts.slice(0, index + 1).join("/");
  }
  const filenameEpisode = parsed.season != null;
  return {
    filePath: entry.relativePath,
    fileName: info.name,
    size: entry.size || 0,
    lastModified: entry.lastModified || 0,
    ext: extOf(info.name),
    title: parsed.title,
    year: parsed.year,
    season,
    episode,
    episodeTitle,
    quality: parsed.quality,
    genres: info.folders.filter((folder) => folder.role === "genre").map((folder) => folder.genre),
    titleFolder,
    showDir,
    dir: info.dir,
    inExtras,
    isEpisode: Boolean((filenameEpisode || seasonFolder) && !inExtras),
  };
}

function looseEpisodeName(record) {
  const base = record.fileName.replace(/\.[^.]+$/, "");
  return /^(episode|ep|part|chapter|e)?[\s._-]*\d{1,3}([\s._-].*)?$/i.test(base);
}

function showTitleFrom(record) {
  if (!isWeakTitle(record.title)) return { title: record.title, year: record.year || record.titleFolder?.year || null };
  if (record.titleFolder && !isWeakTitle(record.titleFolder.title)) {
    return { title: record.titleFolder.title, year: record.titleFolder.year || record.year || null };
  }
  return { title: "Untitled Series", year: record.year || null };
}

function trustedShowDir(record, title) {
  if (!record.showDir || !record.titleFolder) return null;
  if (isWeakTitle(record.title) || titleScore(record.titleFolder.title, title) >= 0.6) return record.showDir;
  return null;
}

function movieTitleFrom(record) {
  const folder = record.titleFolder;
  if (folder && !isWeakTitle(folder.title) && (isWeakTitle(record.title) || titleScore(folder.title, record.title) >= 0.45)) {
    return { title: folder.title, year: folder.year || record.year || null };
  }
  return { title: record.title || stripReleaseTags(record.fileName.replace(/\.[^.]+$/, "")) || "Untitled Movie", year: record.year };
}

function versionOf(record) {
  return {
    filePath: record.filePath,
    fileName: record.fileName,
    size: record.size,
    lastModified: record.lastModified,
    quality: record.quality || record.ext.toUpperCase(),
    ext: record.ext,
  };
}

function qualityRank(quality) {
  const value = String(quality || "").toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return 4;
  if (value.includes("1080")) return 3;
  if (value.includes("720")) return 2;
  if (value.includes("480")) return 1;
  return 0;
}

function sortVersions(versions) {
  return [...versions].sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality) || b.size - a.size);
}

function slugId(type, title, year) {
  return `${type}:${normalizeKey(title)}:${year || "na"}`;
}

function attachNfo(target, nfo) {
  if (!nfo) return;
  if (nfo.plot) target.description = nfo.plot;
  if (nfo.rating) target.rating = nfo.rating;
  if (nfo.year && !target.year) target.year = nfo.year;
  if (nfo.genres?.length) target.genres = [...new Set([...(target.genres || []), ...nfo.genres])];
  if (nfo.runtime && !target.duration) target.duration = Math.round(nfo.runtime * 60);
  if (nfo.title && isWeakTitle(target.title)) target.title = nfo.title;
  target.metaSource = "local";
}

function subtitlesNear(subtitles, filePath) {
  const dir = dirOf(filePath);
  const base = filePath.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
  const parent = dirOf(dir);
  const allowed = new Set([dir, `${dir}/Subs`, `${dir}/Subtitles`, `${dir}/Sub`, `${parent}/Subs`, `${parent}/Subtitles`].map((item) => item.toLowerCase()));
  return subtitles.filter((sub) => {
    if (!allowed.has(dirOf(sub.relativePath).toLowerCase())) return false;
    const stem = String(sub.name || "").replace(/\.[^.]+$/, "").toLowerCase();
    return stem === base || stem.startsWith(`${base}.`) || stem.startsWith(`${base} `) || stem.startsWith(`${base}_`);
  }).map((sub) => sub.relativePath);
}

function attachSubtitles(version, subtitles) {
  version.subtitlePaths = subtitlesNear(subtitles, version.filePath);
  version.subtitlePath = version.subtitlePaths[0] || null;
}

function seasonRank(number) {
  if (number === 1000) return 2000;
  if (number === 0) return 1500;
  return number;
}

export function buildLibrary(entries) {
  const list = (entries || []).map((entry) => ({
    ...entry,
    name: entry.name || String(entry.relativePath || "").split("/").pop(),
    kind: entry.kind || kindOf(entry.name || entry.relativePath),
  }));
  const images = list.filter((entry) => entry.kind === "image");
  const subtitles = list.filter((entry) => entry.kind === "subtitle");
  const nfoByPath = new Map(
    list
      .filter((entry) => entry.kind === "nfo")
      .map((entry) => [entry.relativePath.toLowerCase(), parseNfo(entry.text || "")]),
  );
  const records = list
    .filter((entry) => entry.kind === "video")
    .map(videoRecord)
    .filter(Boolean);

  const dirs = new Map();
  for (const record of records) {
    if (!dirs.has(record.dir)) dirs.set(record.dir, []);
    dirs.get(record.dir).push(record);
  }
  for (const group of dirs.values()) {
    if (!group[0].titleFolder || group.some((record) => record.inExtras)) continue;
    if (group.some((record) => record.isEpisode && /s\d{1,2}[.\s_-]*e\d/i.test(record.fileName))) continue;
    const numbered = group.filter((record) => !record.inExtras && looseEpisodeName(record));
    if (numbered.length >= 2 && numbered.length === group.length) {
      numbered.forEach((record, index) => {
        record.isEpisode = true;
        record.season = record.season ?? 1;
        if (record.episode == null) record.episode = index + 1;
      });
    }
  }

  const seriesMap = new Map();
  for (const record of records.filter((item) => item.isEpisode)) {
    const named = showTitleFrom(record);
    const key = normalizeKey(named.title);
    if (!seriesMap.has(key)) {
      seriesMap.set(key, {
        id: slugId("series", named.title),
        type: "series",
        category: "Series",
        title: named.title,
        year: named.year,
        genres: [],
        rating: null,
        description: "",
        posterPath: null,
        backdropPath: null,
        showDir: trustedShowDir(record, named.title),
        size: 0,
        addedAt: 0,
        duration: null,
        seasonMap: new Map(),
        metaSource: null,
        imdb: false,
      });
    }
    const series = seriesMap.get(key);
    const candidate = trustedShowDir(record, named.title);
    if (candidate && (!series.showDir || candidate.length > series.showDir.length)) series.showDir = candidate;
    if (!series.year && named.year) series.year = named.year;
    series.genres = [...new Set([...series.genres, ...record.genres])];
    series.size += record.size;
    series.addedAt = Math.max(series.addedAt, record.lastModified || 0);
    const seasonNo = record.season ?? 1;
    if (!series.seasonMap.has(seasonNo)) series.seasonMap.set(seasonNo, []);
    series.seasonMap.get(seasonNo).push(record);
  }

  const seriesList = [...seriesMap.values()];
  const absorbed = new Set();
  for (const record of records.filter((item) => !item.isEpisode)) {
    const owner = seriesList.find((series) => series.showDir && (record.filePath === series.showDir || record.filePath.startsWith(`${series.showDir}/`)));
    if (!owner) continue;
    absorbed.add(record);
    if (!owner.seasonMap.has(1000)) owner.seasonMap.set(1000, []);
    const bucket = owner.seasonMap.get(1000);
    bucket.push({
      ...record,
      season: 1000,
      episode: bucket.length + 1,
      episodeTitle: stripReleaseTags(record.fileName.replace(/\.[^.]+$/, "")) || "Extra",
    });
    owner.size += record.size;
    owner.addedAt = Math.max(owner.addedAt, record.lastModified || 0);
  }

  const items = [];
  for (const series of seriesList) {
    const seasons = [...series.seasonMap.entries()]
      .sort((a, b) => seasonRank(a[0]) - seasonRank(b[0]))
      .map(([number, seasonRecords]) => {
        const groups = new Map();
        seasonRecords.forEach((record, index) => {
          const key = record.episode != null ? `e${record.episode}` : `t${normalizeKey(record.episodeTitle) || index}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(record);
        });
        const episodes = [...groups.values()].map((group) => {
          const versions = sortVersions(group.map(versionOf));
          for (const version of versions) attachSubtitles(version, subtitles);
          const primary = group.slice().sort((a, b) => (b.episodeTitle ? 1 : 0) - (a.episodeTitle ? 1 : 0) || b.size - a.size)[0];
          const episodeNo = primary.episode ?? 0;
          const generic = number === 1000 ? "Extra" : `Episode ${episodeNo || ""}`.trim();
          return {
            id: `${series.id}:s${number}e${episodeNo}:${normalizeKey(primary.episodeTitle || generic)}`,
            season: number,
            episode: episodeNo,
            title: primary.episodeTitle || generic,
            size: versions.reduce((sum, version) => sum + version.size, 0),
            duration: null,
            addedAt: Math.max(...group.map((item) => item.lastModified || 0)),
            versions,
            subtitlePath: versions.find((version) => version.subtitlePath)?.subtitlePath || null,
            stillPath: findNamedImage(images, dirOf(versions[0].filePath), [versions[0].fileName.replace(/\.[^.]+$/, ""), "thumb"]),
            stillUrl: "",
            description: "",
          };
        }).sort((a, b) => a.episode - b.episode || a.title.localeCompare(b.title));
        return {
          number,
          name: number === 0 ? "Specials" : number === 1000 ? "Extras" : `Season ${number}`,
          episodes,
        };
      });

    const item = {
      id: series.id,
      type: "series",
      category: "Series",
      title: series.title,
      year: series.year,
      genres: series.genres,
      rating: series.rating,
      description: series.description,
      posterPath: findNamedImage(images, series.showDir || "", ["poster", "folder", "cover", "show", "thumb"]),
      backdropPath: findNamedImage(images, series.showDir || "", ["fanart", "backdrop", "background", "banner"]),
      posterUrl: "",
      backdropUrl: "",
      showDir: series.showDir,
      size: series.size,
      addedAt: series.addedAt,
      duration: null,
      seasons,
      metaSource: null,
      imdb: false,
    };
    attachNfo(item, nfoByPath.get(`${(series.showDir || "").toLowerCase()}/tvshow.nfo`) || nfoByPath.get(`${(series.showDir || "").toLowerCase()}/series.nfo`));
    for (const season of item.seasons) {
      for (const episode of season.episodes) {
        const nfo = nfoByPath.get(episode.versions[0].filePath.replace(/\.[^.]+$/, ".nfo").toLowerCase());
        if (!nfo) continue;
        if (nfo.plot) episode.description = nfo.plot;
        if (nfo.title && /^episode\s+\d+$/i.test(episode.title)) episode.title = nfo.title;
        if (nfo.runtime) episode.duration = Math.round(nfo.runtime * 60);
      }
    }
    items.push(item);
  }

  const movieRecords = records.filter((record) => !record.isEpisode && !absorbed.has(record));
  const movieDirs = new Map();
  for (const record of movieRecords) {
    if (!movieDirs.has(record.dir)) movieDirs.set(record.dir, []);
    movieDirs.get(record.dir).push(record);
  }

  for (const [dir, dirRecords] of movieDirs) {
    const clusters = [];
    for (const record of dirRecords) {
      const named = movieTitleFrom(record);
      let group = clusters.find((item) => titleScore(item.title, named.title) >= 0.8 && (!item.year || !named.year || item.year === named.year));
      if (!group) {
        group = { title: named.title, year: named.year, records: [] };
        clusters.push(group);
      }
      if (!group.year && named.year) group.year = named.year;
      group.records.push(record);
    }
    let assignments = clusters.map((group) => ({ group, extras: [] }));
    const folder = dirRecords[0].titleFolder;
    if (folder && clusters.length > 1) {
      const main = clusters.find((group) => titleScore(group.title, folder.title) >= 0.5);
      if (main) {
        assignments = [{
          group: { ...main, title: titleScore(folder.title, main.title) >= 0.45 ? folder.title : main.title, year: folder.year || main.year },
          extras: clusters.filter((group) => group !== main).flatMap((group) => group.records),
        }];
      }
    }

    for (const assignment of assignments) {
      const usedIds = new Set(items.map((item) => item.id));
      const versions = sortVersions(assignment.group.records.map(versionOf));
      for (const version of versions) attachSubtitles(version, subtitles);
      const extras = assignment.extras.map((record) => {
        const extra = {
          filePath: record.filePath,
          fileName: record.fileName,
          title: stripReleaseTags(record.fileName.replace(/\.[^.]+$/, "")) || "Extra",
          size: record.size,
          lastModified: record.lastModified || 0,
          ext: record.ext,
        };
        attachSubtitles(extra, subtitles);
        return extra;
      });
      let id = slugId("movie", assignment.group.title, assignment.group.year);
      let copy = 2;
      while (usedIds.has(id)) {
        id = `${slugId("movie", assignment.group.title, assignment.group.year)}:${copy}`;
        copy += 1;
      }
      usedIds.add(id);
      const item = {
        id,
        type: "movie",
        category: "Movie",
        title: assignment.group.title,
        year: assignment.group.year,
        genres: [...new Set(assignment.group.records.flatMap((record) => record.genres))],
        rating: null,
        description: "",
        duration: null,
        size: versions.reduce((sum, version) => sum + version.size, 0) + extras.reduce((sum, extra) => sum + extra.size, 0),
        addedAt: Math.max(0, ...assignment.group.records.map((record) => record.lastModified || 0), ...extras.map((extra) => extra.lastModified || 0)),
        versions,
        extras,
        subtitlePath: versions.find((version) => version.subtitlePath)?.subtitlePath || null,
        posterPath: findNamedImage(images, dir, ["poster", "folder", "cover", "thumb", versions[0].fileName.replace(/\.[^.]+$/, "")]),
        backdropPath: findNamedImage(images, dir, ["fanart", "backdrop", "background", "banner"]),
        posterUrl: "",
        backdropUrl: "",
        metaSource: null,
        imdb: false,
        showDir: dir,
      };
      const nfo = nfoByPath.get(`${dir.toLowerCase()}/movie.nfo`) || nfoByPath.get(versions[0].filePath.replace(/\.[^.]+$/, ".nfo").toLowerCase());
      attachNfo(item, nfo);
      if (nfo?.title && titleScore(nfo.title, item.title) >= 0.4) item.title = nfo.title;
      items.push(item);
    }
  }

  items.sort((a, b) => a.title.localeCompare(b.title));
  return items;
}

export function librarySignature(items) {
  const lines = [];
  for (const item of items || []) {
    if (item.type === "movie") {
      for (const version of item.versions || []) lines.push(`${version.filePath}:${version.size}:${version.lastModified || 0}`);
      for (const extra of item.extras || []) lines.push(`${extra.filePath}:${extra.size}:${extra.lastModified || 0}`);
    } else {
      for (const season of item.seasons || []) {
        for (const episode of season.episodes || []) {
          for (const version of episode.versions || []) lines.push(`${version.filePath}:${version.size}:${version.lastModified || 0}`);
        }
      }
    }
  }
  lines.sort();
  return lines.join("\n");
}

export function findItem(items, id) {
  return (items || []).find((item) => item.id === id) || null;
}

export function findEpisode(item, episodeId) {
  if (!item || item.type !== "series") return null;
  for (const season of item.seasons || []) {
    const episode = season.episodes.find((entry) => entry.id === episodeId);
    if (episode) return episode;
  }
  return item.seasons?.[0]?.episodes?.[0] || null;
}
