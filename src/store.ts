import { useSyncExternalStore } from 'react';
import { ME_ID, seedState } from './data';
import type { AppActions, AppState, Book, LibraryEntry, Shelf, User } from './types';

export { ME_ID };
const STORAGE_KEY = 'yohaku-reading-sns';
const SCHEMA_VERSION = 1;
const statusValues = new Set(['want', 'reading', 'read', 'unread']);
const freshState = (): AppState => JSON.parse(JSON.stringify(seedState)) as AppState;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isShelf = (value: unknown): value is Shelf => isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.isPublic === 'boolean' && stringArray(value.bookIds);
const isUser = (value: unknown): value is User => isRecord(value) && ['id', 'name', 'handle', 'bio', 'avatar', 'reading', 'reason'].every((key) => typeof value[key] === 'string') && stringArray(value.lifeNine) && isRecord(value.nineNotes) && Object.values(value.nineNotes).every((note) => typeof note === 'string') && Array.isArray(value.shelves) && value.shelves.every(isShelf) && typeof value.demo === 'boolean';

function validState(value: unknown): value is AppState {
  if (!isRecord(value) || !isUser(value.me) || value.me.id !== ME_ID) return false;
  if (!Array.isArray(value.books) || !value.books.every((book) => isRecord(book) && ['id', 'title', 'author', 'genre', 'description', 'color', 'accent', 'isbn'].every((key) => typeof book[key] === 'string') && typeof book.design === 'number')) return false;
  if (!Array.isArray(value.users) || !value.users.every(isUser)) return false;
  if (!Array.isArray(value.posts) || !value.posts.every((post) => isRecord(post) && ['id', 'userId', 'text', 'threadId', 'createdAt'].every((key) => typeof post[key] === 'string') && (post.bookId === undefined || typeof post.bookId === 'string') && typeof post.spoiler === 'boolean' && typeof post.anonymous === 'boolean' && typeof post.demo === 'boolean' && typeof post.likes === 'number' && typeof post.wants === 'number')) return false;
  if (!Array.isArray(value.comments) || !value.comments.every((comment) => isRecord(comment) && ['id', 'postId', 'userId', 'text', 'threadId', 'createdAt'].every((key) => typeof comment[key] === 'string') && typeof comment.anonymous === 'boolean')) return false;
  if (!Array.isArray(value.library) || !value.library.every((entry) => isRecord(entry) && typeof entry.bookId === 'string' && typeof entry.status === 'string' && statusValues.has(entry.status) && typeof entry.owned === 'boolean')) return false;
  return stringArray(value.following) && stringArray(value.liked) && stringArray(value.wanted);
}

// A single persistence boundary: replace this adapter with a Supabase repository later.
export const repository = {
  load(): AppState {
    try {
      if (typeof window === 'undefined') return freshState();
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      const saved: unknown = JSON.parse(raw);
      if (isRecord(saved) && saved.version === SCHEMA_VERSION && validState(saved.state)) return saved.state;
    } catch { /* Storage may be unavailable, full, or contain old data. */ }
    return freshState();
  },
  save(state: AppState): void {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, state }));
    } catch { /* Keep the current session usable even when browser storage is unavailable. */ }
  },
  reset(): AppState {
    const state = freshState();
    this.save(state);
    return state;
  },
};

let currentState = repository.load();
const listeners = new Set<() => void>();
const uid = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
function commit(update: (state: AppState) => AppState): void {
  const next = update(currentState);
  if (next === currentState) return;
  currentState = next;
  repository.save(currentState);
  listeners.forEach((listener) => listener());
}
function updateMe(update: (me: User) => User): void {
  commit((state) => ({ ...state, me: update(state.me) }));
}

/** Anonymous aliases are stable within a thread and never expose an account handle. */
export function anonymousName(threadId: string, userId: string): string {
  const words = ['琥珀', '若葉', '月影', '木漏れ日', '藍', '白樺', '薄明', 'そよ風', '星屑', '雨音', '灯火', '栞'];
  let hash = 2166136261;
  for (const char of `${threadId}:${userId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const unsigned = hash >>> 0;
  return `匿名の読者・${words[unsigned % words.length]}${String((unsigned >>> 8) % 100).padStart(2, '0')}`;
}

const actions: AppActions = {
  toggleLike(postId) {
    commit((state) => state.posts.some((post) => post.id === postId) ? { ...state, liked: state.liked.includes(postId) ? state.liked.filter((id) => id !== postId) : [...state.liked, postId] } : state);
  },
  toggleWant(postId) {
    commit((state) => {
      const post = state.posts.find((item) => item.id === postId);
      if (!post) return state;
      const remove = state.wanted.includes(postId);
      const library = !remove && post.bookId && !state.library.some((entry) => entry.bookId === post.bookId) ? [...state.library, { bookId: post.bookId, status: 'want' as const, owned: false }] : state.library;
      return { ...state, wanted: remove ? state.wanted.filter((id) => id !== postId) : [...state.wanted, postId], library };
    });
  },
  toggleFollow(userId) {
    commit((state) => userId === ME_ID || !state.users.some((user) => user.id === userId) ? state : { ...state, following: state.following.includes(userId) ? state.following.filter((id) => id !== userId) : [...state.following, userId] });
  },
  setBookStatus(bookId, status) {
    commit((state) => {
      if (!state.books.some((book) => book.id === bookId) || !statusValues.has(status)) return state;
      const existing = state.library.find((entry) => entry.bookId === bookId);
      const entry: LibraryEntry = { bookId, status, owned: existing?.owned ?? false };
      return { ...state, library: existing ? state.library.map((item) => item.bookId === bookId ? entry : item) : [...state.library, entry] };
    });
  },
  toggleOwned(bookId) {
    commit((state) => {
      if (!state.books.some((book) => book.id === bookId)) return state;
      const existing = state.library.find((entry) => entry.bookId === bookId);
      return { ...state, library: existing ? state.library.map((entry) => entry.bookId === bookId ? { ...entry, owned: !entry.owned } : entry) : [...state.library, { bookId, status: 'unread', owned: true }] };
    });
  },
  addBook(input) {
    const normalizedTitle = input.title.trim();
    const normalizedAuthor = input.author.trim();
    if (!normalizedTitle) return '';
    const normalizedIsbn = input.isbn.replace(/[^0-9Xx]/g, '');
    const duplicate = currentState.books.find((book) => (normalizedIsbn && book.isbn.replace(/[^0-9Xx]/g, '') === normalizedIsbn) || (book.title === normalizedTitle && book.author === normalizedAuthor));
    if (duplicate) {
      commit((state) => ({ ...state, library: state.library.some((entry) => entry.bookId === duplicate.id) ? state.library.map((entry) => entry.bookId === duplicate.id ? { ...entry, owned: true } : entry) : [...state.library, { bookId: duplicate.id, status: 'unread', owned: true }] }));
      return duplicate.id;
    }
    const id = uid('book');
    const book: Book = { ...input, id, title: normalizedTitle, author: normalizedAuthor || '著者未登録', genre: input.genre.trim() || 'その他', isbn: normalizedIsbn };
    commit((state) => ({ ...state, books: [...state.books, book], library: [...state.library, { bookId: id, status: 'unread', owned: true }] }));
    return id;
  },
  addPost(input) {
    const text = input.text.trim();
    if (!text) return;
    const id = uid('post');
    commit((state) => ({ ...state, posts: [{ id, userId: ME_ID, text, bookId: input.bookId && state.books.some((book) => book.id === input.bookId) ? input.bookId : undefined, spoiler: input.spoiler, anonymous: input.anonymous, threadId: input.threadId ?? id, createdAt: new Date().toISOString(), likes: 0, wants: 0, demo: false }, ...state.posts] }));
  },
  addComment(postId, input, anonymous) {
    const text = input.trim();
    if (!text) return;
    commit((state) => {
      const post = state.posts.find((item) => item.id === postId);
      if (!post) return state;
      return { ...state, comments: [...state.comments, { id: uid('comment'), postId, userId: ME_ID, text, anonymous, createdAt: new Date().toISOString(), threadId: post.threadId }] };
    });
  },
  updateNine(bookIds, notes) {
    const known = new Set(currentState.books.map((book) => book.id));
    const chosen = [...new Set(bookIds)].filter((id) => known.has(id)).slice(0, 9);
    updateMe((me) => ({ ...me, lifeNine: chosen, nineNotes: Object.fromEntries(chosen.filter((id) => typeof notes[id] === 'string' && notes[id].trim()).map((id) => [id, notes[id].trim()])) }));
  },
  addShelf(name, isPublic) {
    if (!name.trim()) return '';
    const id = uid('shelf');
    updateMe((me) => ({ ...me, shelves: [...me.shelves, { id, name: name.trim(), isPublic, bookIds: [] }] }));
    return id;
  },
  updateShelf(shelf) {
    if (!shelf.name.trim()) return;
    const known = new Set(currentState.books.map((book) => book.id));
    updateMe((me) => ({ ...me, shelves: me.shelves.map((item) => item.id === shelf.id ? { ...shelf, name: shelf.name.trim(), bookIds: [...new Set(shelf.bookIds)].filter((id) => known.has(id)) } : item) }));
  },
  updateProfile(name, bio) {
    if (!name.trim()) return;
    updateMe((me) => ({ ...me, name: name.trim(), bio: bio.trim() }));
  },
};

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => currentState;
export function useAppStore(): { state: AppState; actions: AppActions } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { state, actions };
}

// Make edits from a second tab visible here while preserving the same adapter boundary.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    currentState = repository.load();
    listeners.forEach((listener) => listener());
  });
}
