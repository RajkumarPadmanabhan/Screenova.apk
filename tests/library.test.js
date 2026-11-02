import test from "node:test";
import assert from "node:assert/strict";
import { buildLibrary, parseRelease } from "../js/library.js";

const GB = 1024 ** 3;

function video(path, size = GB, lastModified = 1) {
  return { relativePath: path, name: path.split("/").pop(), size, lastModified, kind: "video" };
}

test("parses show, season, episode title, and keeps a title that is also a year", () => {
  const parsed = parseRelease("The.Mandalorian.S02E05.Chapter.13.The.Jedi.1080p.mkv");
  assert.equal(parsed.title, "The Mandalorian");
  assert.equal(parsed.season, 2);
  assert.equal(parsed.episode, 5);
  assert.equal(parsed.episodeTitle, "Chapter 13 The Jedi");
  assert.equal(parsed.quality, "1080p");
  assert.equal(parseRelease("1917.2019.1080p.BluRay.mkv").title, "1917");
  assert.equal(parseRelease("1917.2019.1080p.BluRay.mkv").year, 2019);
});

test("groups seasons under one series and keeps movies, genres, size, and sidecars", () => {
  const items = buildLibrary([
    video("Movies/Dune Part Two (2024)/Dune.Part.Two.2024.1080p.BluRay.mkv", 2.2 * GB),
    video("Movies/Dune Part Two (2024)/Dune.Part.Two.2024.2160p.BluRay.mkv", 8 * GB),
    video("Movies/Dune Part Two (2024)/Dune.sample.mkv", 30 * 1024 * 1024),
    video("Movies/Dune Part Two (2024)/Deleted Scene.mkv", 400 * 1024 * 1024),
    { relativePath: "Movies/Dune Part Two (2024)/poster.jpg", name: "poster.jpg", kind: "image", size: 1000 },
    { relativePath: "Movies/Dune Part Two (2024)/movie.nfo", name: "movie.nfo", kind: "nfo", text: "<movie><title>Dune: Part Two</title><plot>Paul Atreides unites with the Fremen.</plot><rating>8.7</rating><year>2024</year><genre>Sci-Fi</genre><genre>Adventure</genre><runtime>166</runtime></movie>" },
    { relativePath: "Movies/Dune Part Two (2024)/Dune.Part.Two.2024.1080p.BluRay.en.srt", name: "Dune.Part.Two.2024.1080p.BluRay.en.srt", kind: "subtitle", size: 100 },
    video("Series/The Bear/Season 1/The.Bear.S01E01.720p.mkv", 500 * 1024 * 1024, 10),
    video("Series/The Bear/Season 1/The.Bear.S01E02.720p.mkv", 510 * 1024 * 1024, 11),
    video("Series/The Bear/Season 2/The.Bear.S02E01.1080p.mkv", 800 * 1024 * 1024, 12),
    video("Series/The Bear/Interview.mkv", 200 * 1024 * 1024, 13),
    { relativePath: "Series/The Bear/poster.jpg", name: "poster.jpg", kind: "image", size: 1000 },
    video("Action/John.Wick.2014.1080p.mkv", 1.5 * GB),
    video("Downloads/Breaking.Bad.S01E01.mkv", 300 * 1024 * 1024),
    video("Downloads/Breaking.Bad.S01E02.Pilot.Follow.mkv", 320 * 1024 * 1024),
    video("Comedy/The Office/Season 1/The.Office.S01E01.Pilot.mkv", 250 * 1024 * 1024),
    video("Shows/Paper/01.mkv", 100 * 1024 * 1024),
    video("Shows/Paper/02.mkv", 100 * 1024 * 1024),
  ]);

  const dune = items.find((item) => item.title === "Dune: Part Two");
  assert.ok(dune);
  assert.equal(dune.type, "movie");
  assert.equal(dune.category, "Movie");
  assert.equal(dune.year, 2024);
  assert.equal(dune.rating, 8.7);
  assert.equal(dune.duration, 166 * 60);
  assert.match(dune.description, /Fremen/);
  assert.deepEqual(dune.genres, ["Sci-Fi", "Adventure"]);
  assert.equal(dune.versions.length, 2);
  assert.equal(dune.versions[0].quality, "4K");
  assert.equal(dune.extras.length, 1);
  assert.equal(dune.posterPath, "Movies/Dune Part Two (2024)/poster.jpg");
  assert.ok(dune.subtitlePath.endsWith(".srt"));
  assert.equal(items.some((item) => /sample/i.test(item.title)), false);

  const bear = items.find((item) => item.title === "The Bear");
  assert.ok(bear);
  assert.equal(bear.type, "series");
  assert.equal(bear.category, "Series");
  assert.deepEqual(bear.seasons.map((season) => season.name), ["Season 1", "Season 2", "Extras"]);
  assert.equal(bear.seasons[0].episodes.length, 2);
  assert.equal(bear.seasons[1].episodes[0].episode, 1);
  assert.equal(bear.posterPath, "Series/The Bear/poster.jpg");
  assert.ok(bear.size > 800 * 1024 * 1024);

  const wick = items.find((item) => item.title === "John Wick");
  assert.equal(wick.genres[0], "Action");
  assert.equal(wick.year, 2014);

  const bad = items.find((item) => item.title === "Breaking Bad");
  assert.equal(bad.seasons[0].episodes.length, 2);
  assert.equal(bad.seasons[0].episodes[1].title, "Pilot Follow");

  const office = items.find((item) => item.title === "The Office");
  assert.equal(office.seasons[0].episodes[0].title, "Pilot");

  const paper = items.find((item) => item.title === "Paper");
  assert.equal(paper.type, "series");
  assert.equal(paper.seasons[0].name, "Season 1");
  assert.equal(paper.seasons[0].episodes.length, 2);
});
