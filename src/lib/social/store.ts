"use client";

import { useSyncExternalStore } from "react";
import { ME_ID, type PersistenceStatus } from "../types";
import { demoFollows, demoPosts, demoReactions } from "./data";
import {
  defaultCatalog,
  emptySocialData,
  localSocialRepository,
  minePostId,
  validImage,
  validMinePost,
  type SocialCatalog,
} from "./repository";
import { canWantToRead, findPost } from "./selectors";
import {
  IMAGE_ALT_LIMIT,
  POST_IMAGE_LIMIT,
  POST_TEXT_LIMIT,
  REACTION_KINDS,
  type Post,
  type PostResult,
  type SocialActions,
  type SocialPersonalData,
  type SocialRepository,
  type SocialState,
} from "./types";

/** The demo world plus this browser's activity, in the shape every selector reads. */
export function mergeSocial(personal: SocialPersonalData): SocialState {
  return {
    posts: [...demoPosts, ...personal.posts],
    reactions: [
      ...demoReactions,
      ...personal.reactions.map(({ postId, kind }) => ({
        postId,
        kind,
        readerId: ME_ID,
      })),
    ],
    follows: [
      ...demoFollows,
      ...personal.following.map((followeeId) => ({
        followerId: ME_ID,
        followeeId,
      })),
    ],
    spoilerReports: personal.spoilerReports.map((postId) => ({
      postId,
      reporterId: ME_ID,
    })),
  };
}

// Stable reference for static rendering and the first hydration render.
export const seedSocialState = mergeSocial(emptySocialData());

export function createSocialStore(
  repository: SocialRepository = localSocialRepository,
  clock: () => string = () => new Date().toISOString(),
  catalog: SocialCatalog = defaultCatalog,
) {
  let personal = emptySocialData();
  let state: SocialState = seedSocialState;
  let status: PersistenceStatus = "loading";
  let initialized = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function initialize() {
    if (initialized) return;
    initialized = true;
    const snapshot = repository.load();
    personal = snapshot.data;
    state = mergeSocial(personal);
    status = snapshot.status;
    notify();
  }

  /**
   * A full storage rejects the change instead of keeping it only in memory: a post that
   * silently vanishes on reload is worse than one the writer is told to shorten.
   * Storage that is unavailable altogether (private mode) keeps working in memory, like the town.
   */
  function commit(next: SocialPersonalData): boolean {
    const result = repository.save(next);
    if (result === "quota") return false;
    personal = next;
    state = mergeSocial(next);
    status = result;
    notify();
    return true;
  }

  const isMine = (post: Post | undefined): boolean =>
    post !== undefined && post.authorId === ME_ID && !post.demo;

  const actions: SocialActions = {
    createPost(draft): PostResult {
      initialize();
      const text = draft.text.trim();
      if (text.length > POST_TEXT_LIMIT)
        return { ok: false, reason: "too-long" };
      if (draft.images.length > POST_IMAGE_LIMIT)
        return { ok: false, reason: "too-many-images" };
      if (!text && draft.images.length === 0)
        return { ok: false, reason: "empty" };
      if (!draft.images.every((image) => validImage(image)))
        return { ok: false, reason: "invalid-image" };
      const parent =
        draft.replyTo === null ? null : findPost(state, draft.replyTo);
      if (parent === undefined) return { ok: false, reason: "missing-parent" };
      let book: Post["book"] = null;
      if (draft.book) {
        if (!catalog.bookIds.has(draft.book.bookId))
          return { ok: false, reason: "unknown-book" };
        const purpose = parent ? "recommend" : draft.book.purpose;
        if (purpose === "recommend" && !parent)
          return { ok: false, reason: "invalid-purpose" };
        if (purpose === "review" && !text)
          return { ok: false, reason: "review-needs-text" };
        book = { bookId: draft.book.bookId, purpose };
      }
      const post: Post = {
        id: minePostId(personal.nextPostNumber),
        authorId: ME_ID,
        createdAt: clock(),
        text,
        images: draft.images.map(({ src, alt, width, height }) => ({
          src,
          alt: alt.trim().slice(0, IMAGE_ALT_LIMIT),
          width,
          height,
        })),
        book,
        spoiler: draft.spoiler === true,
        reply: parent
          ? { rootId: parent.reply?.rootId ?? parent.id, parentId: parent.id }
          : null,
        demo: false,
      };
      const known = new Map(state.posts.map((entry) => [entry.id, entry]));
      if (!validMinePost(post, catalog, known))
        return { ok: false, reason: "invalid-purpose" };
      const saved = commit({
        ...personal,
        posts: [...personal.posts, post],
        nextPostNumber: personal.nextPostNumber + 1,
      });
      return saved ? { ok: true, post } : { ok: false, reason: "storage-full" };
    },
    deletePost(postId) {
      initialize();
      if (!isMine(findPost(state, postId))) return false;
      return commit({
        ...personal,
        posts: personal.posts.filter((post) => post.id !== postId),
        reactions: personal.reactions.filter(
          (reaction) => reaction.postId !== postId,
        ),
      });
    },
    setSpoiler(postId, spoiler) {
      initialize();
      const post = findPost(state, postId);
      if (!post || !isMine(post) || post.spoiler === spoiler) return false;
      return commit({
        ...personal,
        posts: personal.posts.map((entry) =>
          entry.id === postId ? { ...entry, spoiler } : entry,
        ),
      });
    },
    toggleReaction(postId, kind) {
      initialize();
      const post = findPost(state, postId);
      if (
        !post ||
        !REACTION_KINDS.includes(kind) ||
        (kind === "wantToRead" && !canWantToRead(post))
      )
        return false;
      const has = personal.reactions.some(
        (reaction) => reaction.postId === postId && reaction.kind === kind,
      );
      return commit({
        ...personal,
        reactions: has
          ? personal.reactions.filter(
              (reaction) =>
                !(reaction.postId === postId && reaction.kind === kind),
            )
          : [...personal.reactions, { postId, kind }],
      });
    },
    toggleFollowReader(readerId) {
      initialize();
      if (readerId === ME_ID || !catalog.readerIds.has(readerId)) return false;
      return commit({
        ...personal,
        following: personal.following.includes(readerId)
          ? personal.following.filter((id) => id !== readerId)
          : [...personal.following, readerId],
      });
    },
    toggleSpoilerReport(postId) {
      initialize();
      const post = findPost(state, postId);
      if (!post || isMine(post)) return false;
      if (personal.spoilerReports.includes(postId))
        return commit({
          ...personal,
          spoilerReports: personal.spoilerReports.filter((id) => id !== postId),
        });
      // An already-flagged post is protected; there is nothing to report.
      if (post.spoiler) return false;
      return commit({
        ...personal,
        spoilerReports: [...personal.spoilerReports, postId],
      });
    },
  };

  return {
    actions,
    initialize,
    getSnapshot: () => state,
    getServerSnapshot: () => seedSocialState,
    getPersonal: () => personal,
    getPersistenceSnapshot: () => status,
    getServerPersistenceSnapshot: (): PersistenceStatus => "loading",
    subscribe(listener: () => void) {
      listeners.add(listener);
      initialize();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const socialStore = createSocialStore();
export const socialActions = socialStore.actions;

export function useSocialStore(): {
  social: SocialState;
  actions: SocialActions;
} {
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.getSnapshot,
    socialStore.getServerSnapshot,
  );
  return { social, actions: socialActions };
}

export function useSocialPersistence(): PersistenceStatus {
  return useSyncExternalStore(
    socialStore.subscribe,
    socialStore.getPersistenceSnapshot,
    socialStore.getServerPersistenceSnapshot,
  );
}
