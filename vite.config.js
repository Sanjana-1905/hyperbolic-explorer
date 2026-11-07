// Vite configuration.
// `base` must match the GitHub repository name, because GitHub Pages serves
// the site from https://<user>.github.io/hyperbolic-explorer/ (a sub-folder),
// not from the domain root. Without it, built asset URLs would point to "/"
// and 404 on Pages.
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/hyperbolic-explorer/',
  server: {
    host: true, // also listen on the LAN so the phone can open the dev server
  },
});
