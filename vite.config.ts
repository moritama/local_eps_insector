import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
      }
    }
  },
  optimizeDeps: {
    // utifを適切に処理させる
    exclude: ['utif']
  }
});
