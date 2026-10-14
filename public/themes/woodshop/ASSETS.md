# Woodshop assets

All room/jacket/wood images are original demo assets. No published book cover is reproduced. Books, titles, POPs, labels and furniture remain independent DOM elements.

Browsers keep a file whose name ends in `-vN` (`wood-v2.webp`, `chain-v1.svg`) for a year without asking again (`vercel.json`), so its bytes never change once it is in `main`. A new look is saved under the next name (`-v(N+1)`), with the CSS or scene pointed at it, and its hash goes into `VERSIONED` in `tests/head.test.ts`, which fails on an in-place edit. Names without a version (`room.webp`, `public/fonts/`) may change in place; browsers keep those for a week.

Phase 2 generated with the built-in image generation tool, 2026-10-12. PNG originals were preserved outside the repo; WebP format conversion only, with no semantic image edits.

- `jackets-v2.webp`: 8 original editorial illustrations in one regular 2x4 atlas. Prompt: "Use case: illustration-story. Asset type: ONE production texture atlas for original illustrated book jackets in a Japanese personal bookstore website. Create a perfectly regular 2 columns by 4 rows grid filling the entire image; 8 equal square edge-to-edge panels, NO margins and NO gutters. Each panel is a different rich editorial illustration with delicate printed paper texture, like the sophisticated warm book cover artwork in the supplied reference. These are ORIGINAL generic illustrations, not reproductions of published covers. Panel order row-major: 1 a mysterious teal ocean below a gold ringed planet against dark midnight stars; 2 blue snowy mountains and a tiny distant traveler, silver-gray skies; 3 amber rainy street with one softly glowing cafe window, navy shadows; 4 violet sunset fading into peach over an open sea with a tiny boat; 5 cream botanical flowers and leaves, quiet sage and ochre watercolor; 6 an indigo forest silhouette under many small stars; 7 pale mint mountain landscape and a winding train track; 8 muted moss-green old city map and architectural linework on ivory paper. Each artwork should have a calm central upper area so actual book titles can be overlaid by HTML. Elegant print illustration, tactile, detailed, sophisticated, clear silhouettes at small sizes. Flat artwork only, not a photo of books or perspective mockup. Absolutely NO text, letters, numbers, typography, logos, borders, book spines, shelf, furniture, interface or watermark. Preserve exact 2x4 grid and distinct color palettes."
- `wood-v2.webp`: one flat photograph-style material. Prompt: "Use case: production texture for a Japanese bookstore web interface. Create ONE flat front-on photograph of a single continuous wide old honey-brown oak board, completely filling the canvas edge to edge. Warm caramel and dark walnut horizontal flowing wood grain, small natural knots, slight scratches and worn edges, fine tactile pores. The exact rich warm wooden shelf and wooden sign texture of a cozy dim bookstore, gently illuminated by amber light. Neutral even illumination across the board so the texture can be reused at different scales behind real HTML text and DOM shelves. Absolutely no objects, no room, no books, no shelves depicted, no typography, no border, no lettering, no hardware, no seams, no watermark. This is a material swatch only, not an interface or background scene. Landscape composition, realistic high resolution photographic detail."

`public/fonts/yomogi.woff2`: subset of Yomogi by the Yomogi Project Authors, renamed internally to Yohaku Hand. Source: https://github.com/google/fonts/tree/main/ofl/yomogi . Licensed under SIL OFL 1.1; unmodified license and copyright in `public/fonts/Yomogi-OFL.txt`. Subset covers ASCII, kana, punctuation and existing content; other glyphs use the system serif fallback.

## Walk redesign after the reference mockup (2026-10-12)

All files below are original. The user's reference mockups were only viewed and measured (sizes, colour statistics); no reference pixels were copied, traced or sampled into any asset. No image-generation tool was available, so everything is procedural or hand-authored vector code; generator scripts were kept outside the repository.

- `room-bokeh-v1.webp`: defocused warm bookstore interior, 1080x1920. numpy/PIL renderer with depth layers (far room, back-wall shelving, dusk window, plant, Edison bulb, near-left bookcase with glass lanterns, floor), each blurred with a disc lens kernel so lights become bokeh discs, then warm grade, vignette and 1.5% grain. Default `scene.background` for woodScene; `room.webp` stays for scenes saved earlier.
- `planks-dark-v1.webp`: procedural mahogany back panel, eight boards with ring/latewood grain, seamless in y.
- `sign-plank-v1.webp`: procedural bleached honey-pine plank with grain, fissures, knots, chipped edges and weathered ends; the lamp hotspot is CSS on top.
- `grain-paper-v1.webp`, `grain-chalk-v1.webp`: seamless 160px paper-fibre and dry-chalk tiles (chalk has alpha pits), used with soft-light and `background-clip: text`.
- `lamp-pendant-v1.svg`: industrial dome pendant drawn as vector code (fitted dome profile, rolled lip, glass bulb, feTurbulence speckle).
- `chain-v1.svg`: hanging chain with arched bridle and screw-eye, one front link and one edge-on link reused with `<use>`.
- `ivy-hang-v1.svg`, `ivy-clump-v1.svg`, `ivy-trail-v1.svg`, `ivy-pot-v1.svg`: one hand-drawn three-lobed leaf outline placed in layered depth (blurred far leaves, lit front leaves) along Catmull-Rom vines.
- `daisy-vase-v1.svg`, `globe-v1.svg`: seeded procedural daisies in a gradient-built glass bottle; an orthographic globe with rough hand-typed continents, graticule and a brass meridian.
- `fg-left-v1.webp`, `fg-right-v1.webp`: pre-blurred foreground with alpha (glass candle holders, varnished table and a book stack; a Windsor chair back), drawn with Canvas 2D in headless Chromium.
- Cover art: a 24-panel procedural atlas was attempted and rejected by review (it looked flatter than `jackets-v2.webp`), so walk face-outs keep the 8 v2 paintings, cropped at their own proportions instead of squashed.

Fonts in `public/fonts/` (SIL OFL 1.1, subsets of ASCII, kana, punctuation and the app's own text; licences shipped next to them):

- `shop-sign-700.woff2` = Kaisei HarunoUmi Bold, `shop-hand-500.woff2` = Kaisei HarunoUmi Medium (`KaiseiHarunoUmi-OFL.txt`), source https://github.com/google/fonts/tree/main/ofl/kaiseiharunoumi
- `jacket-mincho-600.woff2` = Zen Old Mincho SemiBold (`ZenOldMincho-OFL.txt`), source https://github.com/google/fonts/tree/main/ofl/zenoldmincho
- Characters outside the subsets fall back to the same families from Google Fonts (unicode-range slices), then to the serif.

## Home carousel art (`public/home/`, 2026-10-14)

The home's 「今日の街」 slides and the 本棚をのぞく cards use two 16:10 crops of the room images above, cut with PIL (Lanczos, WebP quality 72) at 390, 780 and 1170px wide. No new pixels were drawn; nothing else was changed.

- `shelves-{390,780,1170}-v1.webp`: `room-bokeh-v1.webp`, the box (0, 600)–(1080, 1275). Always the first slide's art, so the static page asks for it first.
- `lamp-{390,780,1170}-v1.webp`: `room.webp`, the box (0, 0)–(940, 588), the lamp and the wall under it.

They follow the same rule as `-vN` files here: kept a year (`vercel.json`, `/home/(.*-v\d+\.webp)`), their bytes recorded in `VERSIONED` in `tests/head.test.ts`. A new look is a new name (`-v2`).
