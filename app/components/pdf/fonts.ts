import { Font } from "@react-pdf/renderer";

let registered = false;

// Fonts live in public/fonts. In Node (server-side rendering) they are read
// from disk; in the browser they are fetched from /fonts/<file>. No Node
// built-ins are imported so this module stays bundleable for the client.
function fontSource(file: string): string {
  if (typeof window === "undefined") {
    return `${process.cwd()}/public/fonts/${file}`;
  }
  return `/fonts/${file}`;
}

export function registerFonts() {
  if (registered) return;
  registered = true;

  Font.register({
    family: "Inter",
    fonts: [
      { src: fontSource("Inter-Regular.ttf"), fontWeight: 400 },
      { src: fontSource("Inter-Bold.ttf"), fontWeight: 700 },
      {
        src: fontSource("Inter-Italic.ttf"),
        fontWeight: 400,
        fontStyle: "italic",
      },
    ],
  });

  Font.register({
    family: "Lora",
    fonts: [
      { src: fontSource("Lora-Regular.ttf"), fontWeight: 400 },
      { src: fontSource("Lora-Bold.ttf"), fontWeight: 700 },
    ],
  });

  Font.registerHyphenationCallback((word) => [word]);
}
