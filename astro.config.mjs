// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // LP2 moved from /v2 to /plus-fb; keep old links working.
  redirects: { '/v2': '/plus-fb' },
});
