import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
  ],
  // Tauri 2.0 自动生成的防端口冲突配置，保持原样即可
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    open: false, // 将其设置为 false，不要自动打开浏览器窗口
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
})