/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['fluent-ffmpeg', 'ffmpeg-static', '@napi-rs/canvas'],
};

export default nextConfig;
