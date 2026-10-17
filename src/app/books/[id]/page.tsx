import TownApp from "../../../components/TownApp";
import { demoBooks } from "../../../lib/data";
import { bookById, bookTitle } from "../../../lib/book-name";
export function generateStaticParams() {
  return demoBooks.map((b) => ({ id: b.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const found = bookById(demoBooks, id);
  return { title: found ? bookTitle(found) : "本" };
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TownApp view="book" selectedId={id} />;
}
