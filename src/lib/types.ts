export const ME_ID = "me";
export const OWN_SHOP_ID = "mine";
export const DEFAULT_SHELF_CAPACITY = 20;

export const POP_REACTIONS = ["like", "read", "love"] as const;
export type PopReaction = (typeof POP_REACTIONS)[number];
export const popReactionKey = (
  shopId: string,
  shelfId: string,
  itemId: string,
) => JSON.stringify([shopId, shelfId, itemId]);

export type BookDisplay = "spine" | "face";
export type ShopTheme = "sage" | "ink" | "ochre" | "rose";

export interface Book {
  id: string;
  title: string;
  author: string;
  genre: string;
  summary: string;
  color: string;
  ink: string;
  height: number;
  thickness: number;
  pattern: number;
}

export interface Reader {
  id: string;
  name: string;
  bio: string;
  color: string;
  lifeNine: string[];
  nineNotes: Record<string, string>;
}

export interface ShelfItem {
  id: string;
  bookId: string;
  display: BookDisplay;
  pop: string;
}

export interface Shelf {
  id: string;
  name: string;
  capacity: number;
  items: ShelfItem[];
  isPublic: boolean;
}

export interface Shop {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  theme: ShopTheme;
  tagline: string;
  followers: number;
  shelves: Shelf[];
  demo: boolean;
}

export interface TownState {
  books: Book[];
  readers: Reader[];
  shops: Shop[];
  me: Reader;
  ownShop: Shop | null;
  following: string[];
  wishlist: string[];
  favorites: string[];
  popReactions: Record<string, PopReaction[]>;
}

export interface TownActions {
  createShop(name: string, description: string, theme: ShopTheme): void;
  updateShop(
    patch: Pick<Shop, "name" | "description" | "theme" | "tagline">,
  ): void;
  addShelf(name: string, capacity?: number): void;
  updateShelf(
    shelfId: string,
    patch: { name?: string; isPublic?: boolean },
  ): void;
  removeShelf(shelfId: string): void;
  addShelfBook(shelfId: string, bookId: string, display: BookDisplay): boolean;
  removeShelfBook(shelfId: string, itemId: string): void;
  moveShelfBook(shelfId: string, itemId: string, toIndex: number): void;
  changeDisplay(shelfId: string, itemId: string, display: BookDisplay): boolean;
  updatePop(shelfId: string, itemId: string, pop: string): void;
  toggleFollow(shopId: string): void;
  toggleWish(bookId: string): void;
  toggleFavorite(bookId: string): void;
  togglePopReaction(
    shopId: string,
    shelfId: string,
    itemId: string,
    reaction: PopReaction,
  ): void;
  updateProfile(name: string, bio: string): void;
  updateNine(ids: string[], notes: Record<string, string>): void;
}

export type AppActions = TownActions;

export const displayCost = (display: BookDisplay): number =>
  display === "face" ? 3 : 1;

export const shelfUsed = (shelf: Shelf): number =>
  shelf.items.reduce((total, item) => total + displayCost(item.display), 0);

export const normalizeCapacity = (capacity?: number): number =>
  typeof capacity === "number" && Number.isFinite(capacity)
    ? Math.min(100, Math.max(1, Math.trunc(capacity)))
    : DEFAULT_SHELF_CAPACITY;

export type PersistenceStatus =
  "loading" | "saved" | "unavailable" | "recovered";
