import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		proxy: {
			'/api': {
				target: process.env.BACKEND_URL ?? 'http://localhost:3001',
				changeOrigin: true
			}
		}
	}
});
