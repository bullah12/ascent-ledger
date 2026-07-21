import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ascent Ledger",
    short_name: "Ascent",
    description:
      "Personal climbing logbook and BMG-standard progress tracker.",
    start_url: "/logbook",
    display: "standalone",
    background_color: "#fdfcf9",
    theme_color: "#28794f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
