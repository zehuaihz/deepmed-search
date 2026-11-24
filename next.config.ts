import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // 启用 standalone 输出模式，用于 Docker 部署
  poweredByHeader: false, // 移除 X-Powered-By 响应头（减小响应、避免暴露技术栈）
  experimental: {
    turbo: {
    },
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // 对大型桶导出（barrel file）的包按需打包，显著减小客户端 JS 体积。
    // Next 15 已内置 lucide-react / radix 等默认项，这里显式声明以确保覆盖。
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-collapsible',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-menubar',
      '@radix-ui/react-navigation-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slider',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      'react-day-picker',
      'date-fns',
      'lodash',
    ],
  },
  serverExternalPackages: ['tesseract.js', 'bullmq', 'redis', 'minio'],
};

export default nextConfig;
