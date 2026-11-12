import { Font } from "@react-pdf/renderer";

let registered = false;

// Fonts live in public/fonts. In the browser they are fetched from
// /fonts/<file>. In Node they are read from disk: from FONTS_DIR when set,
// else from <cwd>/build/client/fonts in production (the image has no public/
// directory) and <cwd>/public/fonts otherwise. This must not depend on another
// module having set FONTS_DIR first: templates register fonts when they load.
// No Node built-ins are imported so this module stays bundleable for the client.
function fontSource(file: string): string {
  if (typeof window === "undefined") {
    const fallback =
      process.env.NODE_ENV === "production" ? "build/client/fonts" : "public/fonts";
    const dir = process.env.FONTS_DIR || `${process.cwd()}/${fallback}`;
    return `${dir.replace(/\/+$/, "")}/${file}`;
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
