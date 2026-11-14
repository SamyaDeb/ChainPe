import type { Me } from '@/api/schema'
import { useAuth } from './AuthContext'

/** The signed-in provider. Screens render only after it has loaded, so it is never null here. */
export function useMe(): Me {
  const { me } = useAuth()
  if (!me) throw new Error('useMe was used before the provider record loaded')
  return me
}
