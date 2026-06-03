import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		// Bundle markdown-it into the portable ltsql tarball; the remote host does not run npm install.
		noExternal: ['markdown-it']
	}
});
