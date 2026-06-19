/** @type {import('next').NextConfig} */
// เบราว์เซอร์เรียก /api/* ที่พอร์ต frontend — rewrite ไป backend (กัน bundle ติด localhost ตอน deploy)
const backendInternal =
  process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cuthuay/bet-parser'],
  webpack: (config, { isServer, webpack }) => {
    if (isServer) {
      const externals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [...externals, 'jspdf', 'canvg'];
    }
    // canvg ships core-js polyfills for old browsers — ignore them; modern browsers/Node don't need them
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^core-js\//,
        contextRegExp: /canvg/,
      })
    );
    // jspdf optionally references html2canvas — not used in our addImage flow
    config.resolve.alias = {
      ...config.resolve.alias,
      'html2canvas': false,
    };
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendInternal.replace(/\/$/, '')}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
