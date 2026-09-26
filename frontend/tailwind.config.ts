import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  plugins: [animate],
  theme: {
    extend: {
      fontFamily: {
        poppins: ["var(--font-poppins)"],
      },
    },
  },
};

export default config;
