---
name: Felt Journal Gallery
colors:
  surface: '#fafaf1'
  surface-dim: '#dbdad2'
  surface-bright: '#fafaf1'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f4eb'
  surface-container: '#efeee6'
  surface-container-high: '#e9e9e0'
  surface-container-highest: '#e3e3da'
  on-surface: '#1b1c17'
  on-surface-variant: '#4f453f'
  inverse-surface: '#2f312b'
  inverse-on-surface: '#f2f1e8'
  outline: '#81756e'
  outline-variant: '#d2c4bb'
  surface-tint: '#715a4a'
  primary: '#312013'
  on-primary: '#ffffff'
  primary-container: '#493527'
  on-primary-container: '#ba9d8b'
  inverse-primary: '#dfc1ad'
  secondary: '#396848'
  on-secondary: '#ffffff'
  secondary-container: '#baefc6'
  on-secondary-container: '#3f6e4d'
  tertiary: '#0e2915'
  on-tertiary: '#ffffff'
  tertiary-container: '#243f2a'
  on-tertiary-container: '#8cab8f'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#fddcc8'
  primary-fixed-dim: '#dfc1ad'
  on-primary-fixed: '#28180c'
  on-primary-fixed-variant: '#584234'
  secondary-fixed: '#baefc6'
  secondary-fixed-dim: '#9fd3ab'
  on-secondary-fixed: '#00210e'
  on-secondary-fixed-variant: '#205032'
  tertiary-fixed: '#caebcc'
  tertiary-fixed-dim: '#afcfb1'
  on-tertiary-fixed: '#05210e'
  on-tertiary-fixed-variant: '#314d37'
  background: '#fafaf1'
  on-background: '#1b1c17'
  surface-variant: '#e3e3da'
  page-canvas: '#E8EDE7'
  paper-surface: '#F7F2E9'
  felt-oatmeal: '#D9CBAF'
  text-charcoal: '#302F2B'
  accent-mustard: '#C9A64B'
typography:
  display-lg:
    fontFamily: Noto Serif
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  display-md:
    fontFamily: Noto Serif
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Noto Serif
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Noto Serif
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
  body-lg:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Manrope
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Manrope
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Manrope
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Manrope
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.25rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system expresses a warm, contemplative, and tactile lifestyle journaling experience. It treats personal memories not as disposable digital feeds or gamified metrics, but as an artisanal pinboard gallery housed inside a physical paper ledger.

The visual direction embraces **Tactile Materiality & Literary Editorialism**. It rejects synthetic neon glows, fluid glassmorphism, and flat digital sterility in favor of authentic craft textures: dense short-fiber felt, solid oiled walnut timber, uncoated cream paper stock, and precise bookish typography. 

The emotional signature is unhurried, reassuring, and reverent:
- **Quiet Craftsmanship**: High-integrity material boundaries ground the user in physical space.
- **Editorial Intimacy**: Thoughtful serif title hierarchy creates the pacing of an exhibition catalogue or private diary.
- **Tactile Honesty**: Direct, physical visual affordances—contact drops, notched frames, and stitched dotted separators—simulate the physical joy of arranging cherished objects on a workshop felt board.

## Colors

The palette is rooted in natural, earthy materials, avoiding stark digital whites or pure blacks.

- **Primary (`#493527`)**: Deep Walnut. Anchors structural borders, heavy physical frames, and core grounding lines across the interface.
- **Secondary (`#4D7D5B`)**: Forest Green. Designates active commitments, affirmative actions, primary buttons, and selected states.
- **Tertiary (`#8FAE92`)**: Muted Sage. Provides atmospheric balance for supportive controls, secondary chips, and calendar highlights.
- **Neutral (`#73746D`)**: Warm Ash Gray. Guides secondary typography, captions, and muted utility iconography without high-contrast starkness.

### Named Specialty Surfaces
- `page-canvas` (`#E8EDE7`): Soft sage ambient base framing the journal workspace.
- `paper-surface` (`#F7F2E9`): Warm cream paper stock for interactive sheets, cards, and modal panels.
- `felt-oatmeal` (`#D9CBAF`): Default textile backing for the central 3:2 exhibition board.
- `text-charcoal` (`#302F2B`): Editorial ink for primary reading titles and long-form journal entries.
- `accent-mustard` (`#C9A64B`): Rare amber highlight for today's markers and focal stars.

## Typography

The typography pairs the literary elegance of **Noto Serif** with the clarity of **Manrope**.

- **Noto Serif** handles evocative page titling, date headlines, and section introductions. It sets the pace of a printed book or gallery plaque.
- **Manrope** powers interface controls, functional readouts, date tags, toolbars, and body narratives. It provides high legibility at small sizes without sterile technical stiffness.
- **Leading & Proportion**: Body copy maintains generous 1.45–1.5 line height ratios to evoke hand-printed letterpress blocks on textured paper.

## Layout & Spacing

Layouts are designed for vertical handheld interfaces, organized around a central display stage and surrounding journal modules.

- **Canvas Alignment**: Outer margins use `1.25rem` (20px) on standard viewports and `1rem` (16px) on compact handhelds.
- **The 3:2 Exhibition Core**: The felt board maintains a locked **3:2 landscape aspect ratio** throughout all workflows (Home overview, Canvas edit, Calendar thumbnail, and Render export). Width fills available safe column bounds with inner padding.
- **Component Breathing Room**: Paper panels sit at least `space-lg` (24px) below the board frame. Interactive items and control clusters preserve minimum 44px hit bounds while relying on `space-sm` (8px) and `space-md` (16px) internal rhythmic offsets.
- **Vertical Hierarchy**: Top device notches and WeChat capsule headers map to clear dedicated margins, while floating sheets anchor securely to bottom device safe edges.

## Elevation & Depth

Visual hierarchy uses physical material stacking rather than diffuse digital shadows or synthetic blurs:

1. **Base Environmental Layer (`#E8EDE7`)**: The flat, textured sage canvas that grounds the entire journal app.
2. **Structural Wood Frame (`#493527`)**: Rests on the base layer with a soft grounded shadow (`0 8px 24px -4px rgba(48, 47, 43, 0.12)`). A slight inner bevel rim marks where the wood wraps the felt board.
3. **Recessed Felt Surface (`#D9CBAF`)**: Sits inside the wood frame, cast with a tiny top-and-left inset shadow (`inset 0 2px 4px rgba(48, 47, 43, 0.15)`) to simulate physical depth inside the timber rim.
4. **Adhered Memory Cutouts**: Transparent cutouts cast a tight, zero-blur contact shadow directly beneath them (`0 2px 5px rgba(48, 47, 43, 0.16)`) to convey physical placement without floating.
5. **Cream Paper Panels (`#F7F2E9`)**: Modal sheets and control pads float above with an ambient drop (`0 6px 20px -2px rgba(48, 47, 43, 0.08)`).

## Shapes

The design uses balanced, rounded contours (Level 2: `0.5rem` base, up to `1rem` and `1.5rem` for cards and frames) that evoke hand-sanded timber and die-cut stationery cards.

- **Walnut Board Frame**: Outer edge features a smooth `1.25rem`–`1.5rem` (20px–24px) corner radius. The inner felt cut matches this radius minus the frame thickness to preserve uniform timber volume.
- **Paper Cards & Bottom Sheets**: Defined with generous `1.5rem` (24px) rounded corners.
- **Action Buttons**: Squircles and rounded rectangles built on `0.75rem`–`1rem` radii.
- **Object Manipulation Handles**: Crisp circular tags (`50%` pill border) anchoring the four adjustment points.
- **Perforations & Dividers**: Dashed stitching marks (`stroke-dasharray: 4 4`) with light perforation notches along receipt-style edges.

## Components

### Buttons
- **Primary Action ("记录今天", "保存到相册")**: Forest Green fill (`#4D7D5B`), cream-white text (`#F7F2E9`), `rounded-lg` (12px–16px), subtle 2px dark-offset bottom edge (`#395D43`) for a tactile physical push feeling. Minimum height: 48px.
- **Secondary Action**: Cream paper background (`#F7F2E9`) with an ash border (`#D9CBAF`), charcoal text (`#302F2B`), or sage tint fill (`#8FAE92` at 15%) paired with forest green typography.
- **Board Transform Grips**: Circular pill buttons (36px × 36px) placed at the four corners of selected cutouts. Cream paper disc (`#F7F2E9`) with crisp forest green stroke icons, casting a tiny contact shadow.

### The 3:2 Felt Board
- Deep walnut timber frame (`#493527`, 8px–12px visible rim) enclosing an oatmeal felt surface (`#D9CBAF`).
- The felt supports optional presets (warm oatmeal, pale sage, soft warm gray).
- Items placed on the board are boundary-clipped to the inner felt, while selection boxes and corner transform handles project over the frame edge.

### Chips & Tags
- Used for dates, memory categories, and counter summaries.
- Pill or `rounded-sm` (6px) silhouettes in cream paper (`#F7F2E9`) with delicate walnut-tinted borders and Manrope label typography (`label-md`).

### Cards & Bottom Sheets
- Formed from warm cream paper stock (`#F7F2E9`) with subtle tonal warmth.
- Dotted dashed lines (`#73746D` at 30% opacity) separate internal header zones, receipt modules, and text notes.

### Checkboxes & Segmented Pickers
- Segmented selectors use an indented cream trough with a sliding sage (`#8FAE92`) or forest green (`#4D7D5B`) felt patch to highlight the active option.
- Toggles feature small wooden/cream toggles shifting across olive-tinted beds.