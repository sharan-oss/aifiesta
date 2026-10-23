// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // LP2 moved /v2 -> /plus-fb -> /basic-plan-v2-fb; keep old links working.
  redirects: { '/v2': '/basic-plan-v2-fb', '/plus-fb': '/basic-plan-v2-fb' },
});
