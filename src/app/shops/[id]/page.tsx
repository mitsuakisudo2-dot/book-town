import TownApp from "../../../components/TownApp";
import { demoShops } from "../../../lib/data";
export function generateStaticParams() {
  return [...demoShops.map((s) => ({ id: s.id })), { id: "mine" }];
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "mine") return { title: "自分の書店" };
  const found = demoShops.find((s) => s.id === id);
  return { title: found ? found.name : "書店" };
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TownApp view="shop" selectedId={id} />;
}
