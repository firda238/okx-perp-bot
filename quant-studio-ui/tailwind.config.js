/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "SF Pro Display", "PingFang SC", "Microsoft YaHei", "sans-serif"],
      },
      colors: {
        ink: "#07111f",
        glass: "#142a48",
        aqua: "#21e6b5",
        risk: "#ff4d6d",
        electric: "#2f80ff",
        violet: "#a855f7",
      },
      boxShadow: {
        glass: "0 20px 60px rgba(0, 0, 0, 0.35), inset 0 1px rgba(255, 255, 255, 0.08)",
        glow: "0 0 32px rgba(47, 128, 255, 0.35)",
      },
    },
  },
  plugins: [],
};
