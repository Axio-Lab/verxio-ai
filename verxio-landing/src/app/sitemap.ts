import type { MetadataRoute } from 'next'

import { APP_URL, SITE_URL } from '@/lib/site'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const blogUrl = 'https://blog.verxio.xyz'
  const now = new Date()

  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0
    },
    {
      url: `${APP_URL}/signup`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9
    },
    {
      url: `${APP_URL}/login`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7
    },
    {
      url: blogUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3
    },
    {
      url: `${SITE_URL}/terms-of-service`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3
    }
  ]
}
