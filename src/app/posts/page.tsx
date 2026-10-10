import TownApp from "../../components/TownApp";
// One static page for every post: the post ID is read from `?id=` on the client,
// because posts written in a browser cannot be prerendered under `output: "export"`.
export default function Page() {
  return <TownApp view="post" />;
}
