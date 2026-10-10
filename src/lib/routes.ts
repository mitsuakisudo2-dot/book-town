// URL builders for SNS screens. Posts made in a browser cannot get their own static page
// under `output: "export"` (every dynamic route needs generateStaticParams), so a post is
// addressed by query string. When posts move to a server, only `post` needs to change.

export const routes = {
  feed: () => "/feed/",
  post: (postId: string) => `/posts/?id=${encodeURIComponent(postId)}`,
  book: (bookId: string) => `/books/${bookId}/`,
  /** A review or recommendation as it appears on the work page. */
  bookPost: (bookId: string, postId: string) =>
    `/books/${bookId}/#post-${postId}`,
  profile: (readerId: string) => `/profiles/${readerId}/`,
  shop: (shopId: string) => `/shops/${shopId}/`,
};
