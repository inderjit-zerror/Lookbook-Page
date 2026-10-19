// Everything the hero shows. Edit freely.

// Giant name at the bottom of the hero (one entry per line).
export const NAME_LINES = ["ZERROR", "LOOKBOOK"];

// Top-left copy.
export const IDENTITY = ["The creative studio", "behind the ZERROR lookbook."];

// Header clocks. `active` gets the green dot, the others red.
export const LOCATIONS = [
  { label: "India", short: "IND", timeZone: "Asia/Kolkata", active: true },
  { label: "United Kingdom", short: "UK", timeZone: "Europe/London", active: false },
];

const CATEGORIES = ["T-Shirt", "Shirt", "Knitwear", "Outerwear", "Essentials"];

// Garments. `rain` is the light texture used while falling
// (generate with `node scripts/make-rain-images.mjs`), `src` the full image.
export const LOOKS = Array.from({ length: 15 }, (_, i) => {
  const n = i + 1;
  return {
    id: n,
    src: `/${n}.webp`,
    rain: `/rain/${n}.webp`,
    title: `Look ${String(n).padStart(2, "0")}`,
    category: CATEGORIES[i % CATEGORIES.length],
    season: "SS26",
    story: [
      "A considered piece from the ZERROR lookbook — cut, colour and fabric developed together for an easy, everyday silhouette.",
    ],
  };
});
