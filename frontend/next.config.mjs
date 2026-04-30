/** @type {import('next').NextConfig} */
// เบราว์เซอร์เรียก /api/* ที่พอร์ต frontend — rewrite ไป backend (กัน bundle ติด localhost ตอน deploy)
const backendInternal =
  process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: true,
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
