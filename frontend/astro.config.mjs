// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
    outDir: '../backend/static',
    server: {
        port: 4321,
    },
});
