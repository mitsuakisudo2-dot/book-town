import TownApp from "../../components/TownApp";
import { NAMES } from "../../lib/words";

export const metadata = { title: `${NAMES.letter}だけ` };
export default function Page() {
  return <TownApp view="timeline" />;
}
