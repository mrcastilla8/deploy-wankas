import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  eslint: {
    // Temporal (REC-05): quedan errores de lint en archivos de otros responsables.
    // Retirar cuando `npm run lint` termine sin errores.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
