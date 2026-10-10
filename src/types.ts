export interface Book {
  id: string;
  title: string;
  author: string;
  genre: string;
  description: string;
  color: string;
  accent: string;
  design: number;
  isbn: string;
}

export interface Shelf {
  id: string;
  name: string;
  isPublic: boolean;
  bookIds: string[];
}

export interface User {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatar: string;
  reading: string;
  reason: string;
  lifeNine: string[];
  nineNotes: Record<string, string>;
  shelves: Shelf[];
  demo: boolean;
}

export interface Post {
  id: string;
  userId: string;
  bookId?: string;
  text: string;
  spoiler: boolean;
  anonymous: boolean;
  threadId: string;
  createdAt: string;
  likes: number;
  wants: number;
  demo: boolean;
}

export interface Comment {
  id: string;
  postId: string;
  userId: string;
  text: string;
  anonymous: boolean;
  createdAt: string;
  threadId: string;
}

export interface LibraryEntry {
  bookId: string;
  status: 'want' | 'reading' | 'read' | 'unread';
  owned: boolean;
}

export interface AppState {
  books: Book[];
  users: User[];
  posts: Post[];
  comments: Comment[];
  library: LibraryEntry[];
  following: string[];
  liked: string[];
  wanted: string[];
  me: User;
}

export interface AppActions {
  toggleLike(postId: string): void;
  toggleWant(postId: string): void;
  toggleFollow(userId: string): void;
  setBookStatus(bookId: string, status: LibraryEntry['status']): void;
  toggleOwned(bookId: string): void;
  addBook(book: Omit<Book, 'id'>): string;
  addPost(input: { text: string; bookId?: string; spoiler: boolean; anonymous: boolean; threadId?: string }): void;
  addComment(postId: string, text: string, anonymous: boolean): void;
  updateNine(bookIds: string[], notes: Record<string, string>): void;
  addShelf(name: string, isPublic: boolean): string;
  updateShelf(shelf: Shelf): void;
  updateProfile(name: string, bio: string): void;
}
