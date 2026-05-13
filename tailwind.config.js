/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        glow: "0 24px 90px rgba(20, 184, 166, 0.18)",
        panel: "0 24px 80px rgba(0, 0, 0, 0.42)",
      },
      keyframes: {
        "soft-pulse": {
          "0%, 100%": { opacity: "0.66", transform: "scaleY(1)" },
          "50%": { opacity: "1", transform: "scaleY(1.05)" },
        },
        sweep: {
          "0%": { transform: "translateX(-18%)" },
          "100%": { transform: "translateX(18%)" },
        },
      },
      animation: {
        "soft-pulse": "soft-pulse 3s ease-in-out infinite",
        sweep: "sweep 7s ease-in-out infinite alternate",
      },
    },
  },
  plugins: [],
};
