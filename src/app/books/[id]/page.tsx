import TownApp from "../../../components/TownApp";
import { demoBooks } from "../../../lib/data";
export function generateStaticParams() {
  return demoBooks.map((b) => ({ id: b.id }));
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TownApp view="book" selectedId={id} />;
}
