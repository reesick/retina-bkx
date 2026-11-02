/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
      colors: {
        canvas: "#000000",
        s1: "#1C1C1E",
        s2: "#2C2C2E",
        sep: "#38383A",
        l2: "rgba(255,255,255,0.6)",
        l3: "rgba(255,255,255,0.32)",
        routine: "#30D158",
        refer: "#FF9F0A",
        urgent: "#FF453A",
        review: "#FFD60A",
        retake: "#64D2FF",
        ma: "#FF375F",
        he: "#FF453A",
        ex: "#FFD60A",
        se: "#E5E5EA",
      },
      fontSize: {
        display: ["160px", { lineHeight: "0.9", letterSpacing: "-0.045em", fontWeight: "600" }],
        hero: ["96px", { lineHeight: "1", letterSpacing: "-0.04em", fontWeight: "600" }],
        "title-xl": ["34px", { lineHeight: "1.15", letterSpacing: "-0.01em", fontWeight: "700" }],
        title: ["22px", { lineHeight: "1.25", fontWeight: "600" }],
        headline: ["17px", { lineHeight: "1.3", fontWeight: "600" }],
        body: ["15px", { lineHeight: "1.45" }],
        footnote: ["13px", { lineHeight: "1.4" }],
        eyebrow: ["11px", { lineHeight: "1.2", letterSpacing: "0.32em", fontWeight: "600" }],
      },
      borderRadius: { card: "22px", ctl: "14px" },
    },
  },
  plugins: [],
};
