import TownApp from "../../../components/TownApp";
import { demoBooks } from "../../../lib/data";
export function generateStaticParams() {
  return demoBooks.map((b) => ({ id: b.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const found = demoBooks.find((b) => b.id === id);
  return { title: found ? found.title : "本" };
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TownApp view="book" selectedId={id} />;
}
