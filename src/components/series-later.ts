import dynamic from "next/dynamic";

// The series' sheet (管理表 13) comes in its own file, read when a reader
// first opens it: a book's page and the scanner only show its door.
export const SeriesSheet = dynamic(
  () => import("./SeriesSheet").then((file) => file.SeriesSheet),
  { loading: () => null },
);
