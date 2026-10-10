import TownApp from "../../../components/TownApp";
import { demoShops } from "../../../lib/data";
export function generateStaticParams() {
  return [...demoShops.map((s) => ({ id: s.id })), { id: "mine" }];
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TownApp view="shop" selectedId={id} />;
}
