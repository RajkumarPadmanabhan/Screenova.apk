import test from "node:test";
import assert from "node:assert/strict";
import { applyMeta, readOmdb } from "../js/metadata.js";

test("reads an OMDb record and leaves N/A fields empty", () => {
  const meta = readOmdb({
    Title: "The Dark Knight",
    Year: "2008",
    Released: "18 Jul 2008",
    Runtime: "152 min",
    Genre: "Action, Crime, Drama",
    Director: "Christopher Nolan",
    Actors: "Christian Bale, Heath Ledger",
    Plot: "Batman raises the stakes.",
    Poster: "https://example.com/poster.jpg",
    Ratings: [
      { Source: "Internet Movie Database", Value: "9.0/10" },
      { Source: "Rotten Tomatoes", Value: "94%" },
      { Source: "Metacritic", Value: "84/100" },
    ],
    imdbRating: "9.0",
    imdbID: "tt0468569",
    Type: "movie",
    Response: "True",
  });
  assert.equal(meta.missed, false);
  assert.equal(meta.director, "Christopher Nolan");
  assert.equal(meta.year, 2008);
  assert.equal(meta.rating, 9);
  assert.equal(meta.released, "18 Jul 2008");
  assert.equal(meta.rottenTomatoes, "94%");
  assert.equal(meta.metacritic, "84/100");
  assert.equal(meta.imdbId, "tt0468569");
  assert.deepEqual(meta.genres, ["Action", "Crime", "Drama"]);

  const missed = readOmdb({ Response: "False", Error: "Movie not found!" });
  assert.equal(missed.missed, true);
  assert.equal(readOmdb({ Response: "False", Error: "Invalid API key!" }).invalidKey, true);

  const blank = readOmdb({
    Response: "True",
    Title: "Example",
    Year: "N/A",
    Director: "N/A",
    Plot: "N/A",
    Poster: "N/A",
    imdbRating: "N/A",
    Genre: "N/A",
    Runtime: "N/A",
    Ratings: [],
  });
  assert.equal(blank.director, "");
  assert.equal(blank.posterUrl, "");
  assert.equal(blank.description, "");
  assert.equal(blank.rating, null);

  const item = { type: "movie", title: "The Dark Knight", description: "", genres: [] };
  assert.equal(applyMeta(item, meta), true);
  assert.equal(item.director, "Christopher Nolan");
  assert.equal(item.year, 2008);
  assert.equal(item.posterUrl, "https://example.com/poster.jpg");
  assert.equal(applyMeta(item, missed), false);
  assert.equal(item.director, "Christopher Nolan");
});
