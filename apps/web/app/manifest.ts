import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Relay",
    short_name: "Relay",
    description: "A self-hosted control plane for autonomous coding agents.",
    start_url: "/board",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#f8fafc",
    icons: [],
  };
}
