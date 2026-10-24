import dynamic from "next/dynamic";

// The series' sheet (管理表 13) comes in its own file, read when a reader
// first opens it: a book's page and the scanner only show its door.
export const SeriesSheet = dynamic(
  () => import("./SeriesSheet").then((file) => file.SeriesSheet),
  { loading: () => null },
);

// A book's page reads its series' small shelf after the page itself: it
// shows only once the series is read, which waits on the network anyway.
export const SeriesStrip = dynamic(
  () => import("./SeriesDoor").then((file) => file.SeriesStrip),
  { loading: () => null },
);
