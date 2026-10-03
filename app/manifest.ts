import type {MetadataRoute} from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tessom",
    short_name: "Tessom",
    description: "Premium upholstery fabric, cut into one-off cushions, pads and totes from what the workshop had left.",
    start_url: "/",
    display: "standalone",
    background_color: "#fdfcf5",
    theme_color: "#fdfcf5",
    icons: [
      {src: "/icon.svg", sizes: "any", type: "image/svg+xml"},
      {src: "/apple-icon.png", sizes: "180x180", type: "image/png"},
    ],
  };
}
