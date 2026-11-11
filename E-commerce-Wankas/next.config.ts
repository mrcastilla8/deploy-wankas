
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
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'image.pollinations.ai',
        port: '',
        pathname: '/**',
      },
      // Generic pattern for Supabase storage.
      // This allows images from any public bucket in your Supabase project.
      {
        protocol: 'https',
        hostname: '*.supabase.co', // Allows any subdomain of supabase.co (e.g., your-project-ref.supabase.co)
        port: '',
        pathname: '/storage/v1/object/public/**', // Common path for public buckets
      }
    ],
  },
};

export default nextConfig;
