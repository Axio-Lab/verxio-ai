import { MOBILE_MEDIA_QUERY } from '@/lib/responsive'

import { useMediaQuery } from './use-media-query'

export const useIsMobile = () => useMediaQuery(MOBILE_MEDIA_QUERY)
