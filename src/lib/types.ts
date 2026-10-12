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
  /** Optional licensed cover or local preview URL; spines remain generated. */
  coverUrl?: string;
  title: string;
  author: string;
  genre: string;
  summary: string;
  color: string;
  ink: string;
  height: number;
  thickness: number;
  pattern: number;
  /** Books the viewer registered (by barcode or by hand) carry their ISBN when known. */
  isbn?: string;
  /** List price in yen, tax included. Demo prices are placeholders, labeled as such. */
  price?: number;
}

export interface Reader {
  id: string;
  /** The reader's public ID, shown as @handle. Lowercase letters, digits and _. */
  handle: string;
  name: string;
  bio: string;
  color: string;
  lifeNine: string[];
  nineNotes: Record<string, string>;
  /** Web pages the reader shares on their profile (note, YouTube, an official site…). */
  links?: string[];
}

export interface ShelfItem {
  id: string;
  bookId: string;
  display: BookDisplay;
  pop: string;
}

export type ShelfDoodle =
  "travel" | "daily" | "forest" | "stars" | "garden" | "city" | "lamp";
export interface Shelf {
  id: string;
  name: string;
  capacity: number;
  items: ShelfItem[];
  isPublic: boolean;
  /** Demo chalkboard copy for the immersive store; optional. */
  board?: { title: string; doodle?: ShelfDoodle };
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

export const POST_MAX_LENGTH = 1000;
/** The same limits as the database (supabase/migrations), so a save is never refused for length. */
export const SHOP_NAME_MAX_LENGTH = 80;
export const SHOP_TAGLINE_MAX_LENGTH = 500;
export const SHOP_DESCRIPTION_MAX_LENGTH = 2000;
export const SHELF_NAME_MAX_LENGTH = 80;
export const POP_MAX_LENGTH = 1000;
export const READER_NAME_MAX_LENGTH = 80;
export const BIO_MAX_LENGTH = 2000;
export const NINE_NOTE_MAX_LENGTH = 500;
export const SHOP_MESSAGE_MAX_LENGTH = 2000;

/** One kind of post. A top-level post with a book is also a review on that book's page. */
export interface Post {
  id: string;
  authorId: string;
  body: string;
  bookId: string | null;
  /** Spoiler posts never reach the timeline; they wait behind the book page's door. */
  spoiler: boolean;
  /** Replies point to a top-level post. Threads are one level deep. */
  parentId: string | null;
  createdAt: string;
  /** Reactions from other readers in the demo data. The viewer's own are stored separately. */
  likes: number;
  wants: number;
  /**
   * Written while reading. "together" memos are ordinary public posts with a reading badge;
   * "solo" memos are private notes only the writer sees.
   */
  readingMode: ReadingMode | null;
}

export interface PostDraft {
  body: string;
  bookId?: string | null;
  spoiler?: boolean;
  parentId?: string | null;
  /** Attach the post to the active reading session, which decides its book and visibility. */
  fromReading?: boolean;
}

export const READING_MODES = ["solo", "together"] as const;
export type ReadingMode = (typeof READING_MODES)[number];

export interface ReadingSession {
  id: string;
  /** Null when the reader started without choosing a book. */
  bookId: string | null;
  mode: ReadingMode;
  startedAt: string;
  /** Null while the session is running. Only one session runs at a time. */
  endedAt: string | null;
}

/** A demo reader who is reading together right now; minutes are counted back from the page load. */
export interface ReadingNow {
  readerId: string;
  bookId: string;
  minutesAgo: number;
}

export const COMPOSE_ICONS = ["pen", "typewriter", "quill"] as const;
export type ComposeIcon = (typeof COMPOSE_ICONS)[number];

export interface Settings {
  composeIcon: ComposeIcon;
}

export interface NewBook {
  title: string;
  author: string;
  isbn?: string;
  price?: number;
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
  posts: Post[];
  likedPosts: string[];
  /** Posts that made the viewer want to read their book; the post records who inspired it. */
  wantedPosts: string[];
  spoilerReports: string[];
  readingNow: ReadingNow[];
  readingSessions: ReadingSession[];
  finishedBooks: string[];
  /** Books the viewer registered as their own, newest last. */
  library: string[];
  settings: Settings;
  seenNotifications: string[];
  /** Words other readers left at the viewer's shop. Only an account receives them. */
  shopMessages: ShopMessage[];
}

export interface ShopMessage {
  readerId: string;
  text: string;
  /** When the reader last wrote it. */
  at: string;
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
  addShelfBook(
    shelfId: string,
    bookId: string,
    display: BookDisplay,
    /** Puts a book that was just taken off back with its POP, at its old place. */
    restore?: { pop: string; index: number },
  ): boolean;
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
  updateProfile(
    name: string,
    bio: string,
    links?: string[],
    handle?: string,
  ): boolean;
  updateNine(ids: string[], notes: Record<string, string>): void;
  createPost(draft: PostDraft): string | null;
  deletePost(postId: string): void;
  toggleLike(postId: string): void;
  toggleWant(postId: string): void;
  toggleSpoilerReport(postId: string): void;
  startReading(bookId: string | null, mode: ReadingMode): string | null;
  endReading(finished: boolean): void;
  addBook(book: NewBook): string | null;
  toggleLibrary(bookId: string): void;
  setComposeIcon(icon: ComposeIcon): void;
  markNotificationsSeen(ids: string[]): void;
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
  /** Changes are on their way to the account. */
  "loading" | "saving" | "saved" | "unavailable" | "recovered";
