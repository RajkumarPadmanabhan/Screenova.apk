const now = Date.now();

function movie(title, year, genres, rating, size, description, addedAt) {
  return {
    id: `movie:${title.toLowerCase()}:${year}`,
    type: "movie",
    category: "Movie",
    title,
    year,
    genres,
    rating,
    imdb: true,
    description,
    duration: 2 * 3600 + 12 * 60,
    size,
    addedAt,
    versions: [{
      filePath: `preview/${title}.mp4`,
      fileName: `${title}.mp4`,
      size,
      quality: "1080p",
      ext: "mp4",
      lastModified: addedAt,
    }],
    extras: [],
    subtitlePath: null,
    posterPath: "",
    backdropPath: "",
    posterUrl: "",
    backdropUrl: "",
    metaSource: null,
    credits: [],
    showDir: `Preview/${title}`,
  };
}

function episode(seriesId, season, number, title, size) {
  return {
    id: `${seriesId}:s${season}e${number}`,
    season,
    episode: number,
    title,
    size,
    duration: 48 * 60,
    addedAt: now - number * 86400000,
    versions: [{
      filePath: `preview/${seriesId}-s${season}e${number}.mp4`,
      fileName: `${title}.mp4`,
      size,
      quality: "1080p",
      ext: "mp4",
      lastModified: now,
    }],
    subtitlePath: null,
    stillPath: "",
    stillUrl: "",
    description: `${title} continues the season.`,
  };
}

export function previewLibrary() {
  const harbor = "series:glass harbor:na";
  return [
    movie("Northline", 2024, ["Action", "Thriller"], 8.4, 2.4 * 1024 ** 3, "A courier crosses a frozen harbour city to return a case she was never meant to open.", now - 86400000),
    movie("Paper Orbit", 2023, ["Sci-Fi", "Adventure"], 7.8, 3.1 * 1024 ** 3, "Two archivists find a map that only appears when the city lights go out.", now - 3 * 86400000),
    movie("Warm Static", 2022, ["Comedy", "Drama"], 7.2, 1.6 * 1024 ** 3, "A late-night radio host tries to keep the station on air through one impossible shift.", now - 8 * 86400000),
    movie("Low Tide Letters", 2021, ["Drama", "Romance"], 8.1, 1.9 * 1024 ** 3, "Letters wash ashore in a town that insists nobody is missing.", now - 12 * 86400000),
    {
      id: harbor,
      type: "series",
      category: "Series",
      title: "Glass Harbor",
      year: 2024,
      genres: ["Drama", "Mystery"],
      rating: 8.6,
      imdb: true,
      description: "A harbour town keeps its storms, debts, and family secrets in the same ledger.",
      duration: null,
      size: 6.4 * 1024 ** 3,
      addedAt: now - 2 * 86400000,
      posterPath: "",
      backdropPath: "",
      posterUrl: "",
      backdropUrl: "",
      credits: [],
      showDir: "Preview/Glass Harbor",
      seasons: [
        {
          number: 1,
          name: "Season 1",
          episodes: [
            episode(harbor, 1, 1, "The Ledger", 750 * 1024 ** 2),
            episode(harbor, 1, 2, "Red Water", 760 * 1024 ** 2),
            episode(harbor, 1, 3, "Night Market", 740 * 1024 ** 2),
          ],
        },
        {
          number: 2,
          name: "Season 2",
          episodes: [
            episode(harbor, 2, 1, "Blackout", 820 * 1024 ** 2),
            episode(harbor, 2, 2, "The Return Tide", 830 * 1024 ** 2),
          ],
        },
      ],
    },
    {
      id: "series:kitchen after dark:na",
      type: "series",
      category: "Series",
      title: "Kitchen After Dark",
      year: 2023,
      genres: ["Comedy"],
      rating: 8.2,
      imdb: true,
      description: "A small restaurant crew survives dinner service, one bad idea at a time.",
      duration: null,
      size: 4.2 * 1024 ** 3,
      addedAt: now - 5 * 86400000,
      posterPath: "",
      backdropPath: "",
      posterUrl: "",
      backdropUrl: "",
      credits: [],
      showDir: "Preview/Kitchen After Dark",
      seasons: [
        {
          number: 1,
          name: "Season 1",
          episodes: [
            episode("series:kitchen after dark:na", 1, 1, "Family Meal", 500 * 1024 ** 2),
            episode("series:kitchen after dark:na", 1, 2, "The Pass", 510 * 1024 ** 2),
          ],
        },
      ],
    },
  ];
}
