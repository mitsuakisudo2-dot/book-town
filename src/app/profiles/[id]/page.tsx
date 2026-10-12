import TownApp from "../../../components/TownApp";
import { demoReaders } from "../../../lib/data";
export function generateStaticParams() {
  return [...demoReaders.map((r) => ({ id: r.id })), { id: "me" }];
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "me") return { title: "プロフィール" };
  const found = demoReaders.find((r) => r.id === id);
  return { title: found ? found.name : "読書家" };
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TownApp view="profile" selectedId={id} />;
}
