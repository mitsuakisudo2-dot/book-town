// The CSS every page reads, in the order the town has always read it: the
// shell (the top and bottom bars, covers) and the parts more than one screen
// draws. Rules of one file style parts of others, and a later file wins a
// tie, so these stay in this order.
//
// A screen's own CSS comes with the screen instead (next/dynamic): walk.css
// with the shop (WalkView, StoreCanvas, ShelfZoom), home.css with Home, the
// editors', the scan's, the library's, 手に取った本's, the credits' and the
// block list's. It comes after these, so a rule of it that ties with one
// here must be one that won before too (docs/09 「速さの3本目」). A
// component drawing its classes imports it, or is read only by components
// that do, so it is there whichever way a page was reached
// (tests/tokens.test.ts).
import "./illustrated-jackets.css";
import "./kept-draft.css";
import "./walk-shared.css";
import "./social.css";
import "./poster-screen.css";
import "./report.css";
import "./letter/letter.css";
import "./profile.css";
import "./reading.css";
import "./poster.css";
import "./records.css";
import "./visibility.css";
import "./street.css";
import "./home/home-shared.css";
import "./usability.css";
import "./shop-journey.css";
import "./visitor.css";
import "./leave.css";
