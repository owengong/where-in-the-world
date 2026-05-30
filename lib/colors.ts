// Single source of truth for the 3-tier pin palette so the map, the browse
// list, and the search palette all read as one system. No React imports — safe
// to use from anywhere (and a future native client).
import type { PlaceCategory } from '@/lib/types';

export const CATEGORY_COLOR: Record<PlaceCategory, string> = {
  resident: '#22c55e', // green — lives / from / family
  visited: '#3b82f6', // blue — visited
  wishlist: '#eab308', // yellow — wishlist only
};

// Yellow needs dark text to stay legible; green/blue use white.
export const CATEGORY_TEXT: Record<PlaceCategory, string> = {
  resident: '#ffffff',
  visited: '#ffffff',
  wishlist: '#374151',
};

// Highest tier wins for a place or a mixed cluster (resident 2 > visited 1 > wishlist 0).
export function colorForRank(rank: number): string {
  return rank >= 2 ? CATEGORY_COLOR.resident : rank === 1 ? CATEGORY_COLOR.visited : CATEGORY_COLOR.wishlist;
}
export function textForRank(rank: number): string {
  return rank >= 2 ? CATEGORY_TEXT.resident : rank === 1 ? CATEGORY_TEXT.visited : CATEGORY_TEXT.wishlist;
}
