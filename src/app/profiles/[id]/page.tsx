import TownApp from "../../../components/TownApp";
import { demoReaders } from "../../../lib/data";
export function generateStaticParams() {
  return [...demoReaders.map((r) => ({ id: r.id })), { id: "me" }];
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TownApp view="profile" selectedId={id} />;
}
