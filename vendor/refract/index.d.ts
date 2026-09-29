// Refract: types as documentation. Two ways in, one set of markup:
//   1. HTML + CSS classes (`rf-*`) + `Refract.init()`: works in any stack.
//   2. React 18 components on `window.Refract` (created lazily from window.React).
import type * as React from 'react';

/* ------------------------------------------------------------------ shared vocab */
export type Tone = 'accent' | 'positive' | 'caution' | 'critical' | 'neutral';
export type Hue = 'coral' | 'amber' | 'green' | 'teal' | 'sky' | 'indigo' | 'violet' | 'rose';
export type Size = 'sm' | 'md' | 'lg';
/** regular (default) · thick (menus, sheets, sidebars) · clear (over media, with a Scrim) · tinted (the primary action) · solid */
export type GlassVariant = 'regular' | 'thick' | 'clear' | 'tinted' | 'solid';
/** true = regular strength; 'soft' | 'strong' scale the refraction. Chromium renders it; other engines keep blur, rim and specular. */
export type LensStrength = boolean | 'soft' | 'strong';
export type ThemeId = 'light' | 'dark' | 'light-contrast' | 'dark-contrast';
export type IconName =
  | 'home' | 'search' | 'bell' | 'person' | 'people' | 'sliders' | 'plus' | 'minus' | 'close' | 'check'
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'chevron-up' | 'more' | 'share' | 'heart' | 'star' | 'bookmark'
  | 'trash' | 'pencil' | 'compose' | 'filter' | 'grid' | 'list' | 'calendar' | 'clock' | 'timer' | 'pin' | 'map' | 'compass'
  | 'navigate' | 'camera' | 'image' | 'play' | 'pause' | 'skip-back' | 'skip-forward' | 'shuffle' | 'repeat' | 'volume'
  | 'volume-low' | 'mic' | 'music' | 'send' | 'mail' | 'chat' | 'reply' | 'inbox' | 'archive' | 'folder' | 'doc' | 'copy'
  | 'link' | 'download' | 'upload' | 'lock' | 'eye' | 'sun' | 'moon' | 'cloud' | 'drop' | 'wave' | 'mountain' | 'leaf'
  | 'sparkle' | 'bolt' | 'layers' | 'globe' | 'wifi' | 'info' | 'alert' | 'check-circle' | 'x-circle' | 'plus-circle'
  | 'arrow-right' | 'arrow-left' | 'arrow-up-right' | 'refresh' | 'sidebar' | 'library' | 'bag' | 'tag' | 'flag' | 'chart' | 'sort';

/* ------------------------------------------------------------------ vanilla API */
export interface ToastOptions {
  title: string;
  message?: string;
  tone?: Tone;
  /** An icon name, or false for none. Defaults by tone. */
  icon?: IconName | false;
  action?: { label: string; onClick?: () => void };
  /** ms before it lifts away; 0 keeps it until dismissed. Default 4000 (6000 with an action). */
  duration?: number;
  position?: 'top' | 'bottom';
}
export interface DialogOptions {
  title: string;
  message?: string;
  icon?: IconName;
  tone?: 'critical';
  actions?: Array<{ label: string; value?: string; variant?: 'filled' | 'gray' | 'plain' | 'soft'; tone?: Tone; autofocus?: boolean }>;
  /** Backdrop click and Esc close it. Default true. */
  dismissible?: boolean;
}
export interface LensOptions { bezel?: number; depth?: number; profile?: 'squircle' | 'circle' | 'soft' }

export type SpringToken = 'spring-smooth' | 'spring-snappy' | 'spring-bouncy' | 'spring-gel' | 'spring-jelly';
export interface Rect { left: number; top: number; width: number; height: number }
export interface MaterializeOptions {
  /** The element or box the surface grows out of (default: a smaller copy of itself). */
  from?: HTMLElement | Rect | null;
  /** The surface's final box when it is not laid out yet (a popover in beforetoggle). */
  rect?: Rect;
  /** Start scale, 0.9 (menus from glass buttons use 0.8). */
  scale?: number;
  /** Fade `from` out while the surface covers it; it comes back on dematerialize. */
  hideSource?: boolean;
  /** Stagger the children in (default true). [role="group"] and [data-rf-stagger] children are staggered individually. */
  content?: boolean;
  /** [x, y] fractions to grow from when there is no source. */
  origin?: [number, number];
  /** Corner radius of a Rect source. */
  radius?: number;
  /** A jelly wobble once it has popped out (0.03 is lively; menus from glass buttons use 0.035). */
  wobble?: number;
  delay?: number;
  duration?: number;
}

export interface RefractAPI {
  version: string;
  /** Enhance everything under root: icons, light, lensing, behaviours. Idempotent. */
  init(root?: ParentNode | Element, options?: { light?: boolean }): RefractAPI;
  /** Keep enhancing nodes added later (SPAs, streamed HTML). Returns a stop function. */
  observe(root?: Node): () => void;
  /** Detach every behaviour from an element. */
  destroy(el: Element): void;
  /** Re-sync a behaviour after a framework changed state it cannot observe (segmented value, slider value, tab). */
  refresh(el: Element): void;
  supports: { lens: boolean; backdrop: boolean; popover: boolean; scrollTimeline: boolean; viewTransition: boolean; closedBy: boolean; linear: boolean };
  prefs: { readonly reducedMotion: boolean; readonly reducedTransparency: boolean; readonly contrast: boolean };

  /** Real refraction for one element (Chromium). Returns cleanup. Prefer data-lens in markup. */
  lens(el: HTMLElement, options?: LensOptions): () => void;
  /** A standalone lens filter for custom surfaces; null where unsupported. */
  lensFilter(width: number, height: number, options?: LensOptions & { radius?: number }): { id: string; url: string; remove(): void } | null;
  /** The shared light source that glass rims catch. */
  light: {
    register(el: Element): () => void;
    /** 'pointer' (default), 'orbit' (slow ambient drift), 'fixed', 'tilt' (device motion). */
    mode(mode: 'pointer' | 'orbit' | 'fixed' | 'tilt', angleDeg?: number): string;
    angle(deg: number): void;
    requestTilt(): Promise<boolean>;
    refresh(): void;
  };

  theme: {
    get(el?: Element): ThemeId;
    set(id: ThemeId, el?: Element): ThemeId;
    /** Follow the OS colour scheme and Increase Contrast. Returns a stop function. */
    auto(el?: Element): () => void;
    opposite(id: ThemeId): ThemeId;
    /**
     * Flip a small floating glass element light/dark as it crosses content regions marked
     * data-rf-tone="dark" | "light" | "inverse". Attached automatically to [data-rf-adapt]. Returns cleanup.
     */
    adapt(el: HTMLElement, options?: { root?: Element | Document }): () => void;
    /**
     * Glass inside a region marked data-rf-tone takes the region's tone (a night photo stays dark in the
     * light theme; "inverse" follows bg-inverse). Attached automatically to [data-rf-tone]. Returns cleanup.
     */
    region(el: HTMLElement): () => void;
  };
  /** 0 = ultra clear, 0.5 = regular (default), 1 = fully tinted. */
  setDensity(value: number, el?: HTMLElement): number;
  setMotion(mode: 'reduced' | 'full' | 'system'): void;
  setTransparency(mode: 'reduced' | 'system'): void;

  icons: Record<IconName, string>;
  /** Inline SVG markup for an icon (currentColor, 1.75 stroke). */
  icon(name: IconName, options?: { size?: 'sm' | 'lg'; label?: string; className?: string }): string;

  toast: ((options: ToastOptions | string) => { el: HTMLElement; close(): void }) & { close(el: HTMLElement): void; dismissAll(): void };
  dialog: { open(target: HTMLDialogElement | DialogOptions): Promise<string>; close(el: HTMLDialogElement, value?: string): void };
  sheet: {
    open(el: HTMLElement, options?: { detent?: 'small' | 'medium' | 'large' }): Promise<string>;
    close(el: HTMLElement, value?: string): void;
    detent(el: HTMLElement, name: 'small' | 'medium' | 'large'): string;
  };
  /** Menus and popovers materialize out of their trigger. { focus: false } opens without moving focus. */
  menu: { open(el: HTMLElement, trigger?: HTMLElement, options?: { focus?: boolean }): void; close(el: HTMLElement): void; toggle(el: HTMLElement, trigger?: HTMLElement, options?: { focus?: boolean }): void };
  /** A control becomes the surface it opens (materialize out of it), and dissolves back into it. */
  morph: {
    open(trigger: HTMLElement, surface: HTMLElement, options?: { focus?: boolean }): Promise<void>;
    close(surface: HTMLElement): Promise<void>;
    toggle(trigger: HTMLElement, surface: HTMLElement): Promise<void>;
    transition(update: () => void): Promise<void>;
  };
  /** View transition on the system springs, instant under Reduce Motion. */
  transition(update: () => void): Promise<void>;
  /** Glass on one plane: merge through a liquid neck and snap apart; add and remove pinch in and out. */
  group: { merge(el: HTMLElement, merged?: boolean): Promise<void>; add(el: HTMLElement, node: HTMLElement): HTMLElement; remove(node: HTMLElement): void };
  /**
   * Glass forms instead of fading: the shape grows out of `from` while blur, tint, lensing and the rim
   * arrive together (--rf-mat), the light runs round the rim (--rf-sweep), the shadow lifts in last and
   * the content settles in, nearest the source first. Resolves when the shape has settled.
   */
  materialize(el: HTMLElement, options?: MaterializeOptions): Promise<void>;
  /** The reverse: content blurs out, the shape shrinks into its source as the glass dissolves, the source returns. Holds its end state. */
  dematerialize(el: HTMLElement, options?: { to?: HTMLElement | Rect | null; rect?: Rect; scale?: number; content?: boolean; showSource?: boolean; duration?: number }): Promise<void>;
  /** Shape-shift keyed parts ([data-rf-key]) between states: arriving parts bud out, leaving parts pinch off, changed parts flow to their new width. */
  shapeshift(root: HTMLElement, update: () => void, options?: { spring?: SpringToken }): Promise<void>;
  /** Animate a layout change: measure `targets`, run `mutate`, spring each from where it was. Interruptible. */
  flip(targets: Iterable<Element>, mutate?: () => void, options?: { spring?: SpringToken; scale?: boolean }): Promise<void>;
  /** The same keyframes over a list with a rising delay. */
  stagger(nodes: Iterable<Element>, keyframes: Keyframe[], options?: KeyframeAnimationOptions & { each?: number; max?: number; spring?: SpringToken }): Animation[];
  /** Send the light once round a glass rim. */
  sweep(el: HTMLElement, options?: { from?: number; to?: number; duration?: number }): Animation;
  /** Roll a number or short label to a new value in the direction it changed (inputs too); badges bump. */
  roll(el: HTMLElement, value: string | number, options?: { dir?: 1 | -1; from?: string | number }): void;
  /** A small spring pulse on something that just changed. */
  bump(el: HTMLElement): void;
  /**
   * Jelly: a volume-keeping squash-and-stretch wobble that dies away, layered on whatever the element is doing.
   * angle: the axis it stretches along (0 horizontal, 90 vertical). impact: start squashed (a landing) instead of at rest (a release).
   */
  jiggle(el: Element, options?: { angle?: number; amount?: number; duration?: number; freq?: number; delay?: number; impact?: boolean }): Animation;
  /** A rotational wobble that dies away (a symbol shaking itself awake). */
  wiggle(el: Element, options?: { deg?: number; duration?: number; freq?: number; delay?: number }): Animation;
  /**
   * Glass beads spray out of an element (or a point) with a ring of light, arc under a little gravity and pop.
   * `data-rf-burst` on a control does this when it turns on. Never runs under Reduce Motion.
   */
  burst(el: Element, options?: { count?: number; hue?: string; colors?: string[]; size?: [number, number]; spread?: number; gravity?: number; ring?: boolean; x?: number; y?: number; arc?: [number, number] }): void;
  /** Stop the motion Refract started on a surface. */
  settle(el: HTMLElement): void;
  /** A demo loop that runs only while `root` is on screen and stops for good at the first touch, click or key; never under Reduce Motion. Returns stop(). */
  autoplay(step: (i: number) => void, options?: { root?: Element; every?: number; delay?: number }): () => void;
  motion: Pick<RefractAPI, 'materialize' | 'dematerialize' | 'shapeshift' | 'flip' | 'stagger' | 'sweep' | 'roll' | 'bump' | 'settle' | 'autoplay' | 'jiggle' | 'wiggle' | 'burst'> & { radiusOf(el: Element, box?: Rect): number };
  /** Web Animations with the system springs; collapses to a fade under Reduce Motion. */
  animate(el: Element, keyframes: Keyframe[], options?: KeyframeAnimationOptions & { spring?: SpringToken; reduced?: Keyframe[] }): Animation;
  /** Interruptible, velocity-aware spring for pointer-driven values. */
  spring(options: { value?: number; stiffness?: number; damping?: number; mass?: number; onUpdate?: (x: number, v: number) => void; onRest?: (x: number) => void }): {
    readonly value: number; readonly velocity: number; set(v: number): void; to(v: number, velocity?: number): void; stop(): void;
  };
  easing(token: string, fallback?: string): string;
  duration(token: string, fallback?: number): number;
}

/* ------------------------------------------------------------------ React components */
type Native<T> = Omit<React.HTMLAttributes<T>, 'onChange' | 'onToggle' | 'title'>;

/** A glass surface. Children sit on the material; never nest glass in glass. */
export interface GlassProps extends Native<HTMLElement> { as?: React.ElementType; variant?: GlassVariant; shape?: 'capsule' | 'circle' | 'rect' | 'panel'; tone?: Tone | Hue; lens?: LensStrength; interactive?: boolean; children?: React.ReactNode }
export declare function Glass(props: GlassProps): React.ReactElement;

/** Demo backdrop (content layer) that gives glass something to bend. */
export interface SceneProps extends Native<HTMLElement> { scene?: 'dunes' | 'lagoon' | 'citrus' | 'night' | 'forest' | 'dusk' | 'stripes' | 'grid' | 'plain'; as?: React.ElementType; children?: React.ReactNode }
export declare function Scene(props: SceneProps): React.ReactElement;

export interface IconProps { name: IconName; size?: 'sm' | 'lg'; label?: string; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

/** Glass (navigation layer) or content-layer button. `variant: 'tinted'` is the one primary action per view. */
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'glass' | 'tinted' | 'filled' | 'soft' | 'gray' | 'plain';
  tone?: Tone | Hue;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  shape?: 'capsule' | 'circle' | 'rect';
  /** Render as glass (implied by 'glass' and 'tinted'). */
  glass?: boolean;
  lens?: LensStrength;
  loading?: boolean;
  icon?: IconName;
  iconEnd?: IconName;
  /** id of a Menu or Popover to open (popovertarget). */
  menu?: string;
  block?: boolean;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface ToolbarProps extends Native<HTMLDivElement> { position?: 'top' | 'bottom'; label: string; children?: React.ReactNode }
export declare function Toolbar(props: ToolbarProps): React.ReactElement;
/** A glass capsule of plain buttons inside a Toolbar. */
export interface ToolbarGroupProps extends Native<HTMLDivElement> { lens?: boolean; children?: React.ReactNode }
export declare function ToolbarGroup(props: ToolbarGroupProps): React.ReactElement;

/** A thick-glass popover menu that grows out of its trigger. Open it with <Button menu={id}>. */
export interface MenuProps extends Native<HTMLDivElement> { id: string; label: string; placement?: 'cover' | 'below'; onSelect?: (detail: { item: HTMLElement; value: string; label: string }) => void; children?: React.ReactNode }
export declare function Menu(props: MenuProps): React.ReactElement;
export interface MenuItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> { icon?: IconName; shortcut?: string; tone?: 'critical'; type?: 'item' | 'checkbox' | 'radio'; checked?: boolean; value?: string; keepOpen?: boolean }
export declare function MenuItem(props: MenuItemProps): React.ReactElement;
export declare function MenuSeparator(): React.ReactElement;
export declare function MenuLabel(props: { children?: React.ReactNode }): React.ReactElement;
/** A row of icon tiles at the top of a menu (quick actions). */
export declare function MenuRow(props: { children?: React.ReactNode }): React.ReactElement;
export declare function MenuTile(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName }): React.ReactElement;

/** Rich content in thick glass, anchored to its trigger. Open it with <Button menu={id}>. */
export interface PopoverProps extends Native<HTMLDivElement> { id: string; label: string; placement?: 'cover' | 'below'; children?: React.ReactNode }
export declare function Popover(props: PopoverProps): React.ReactElement;

export interface TabItem { id?: string; label: string; icon: IconName; href?: string; badge?: React.ReactNode }
/** A floating glass capsule of 3 to 5 destinations with a liquid selection lens. */
export interface TabBarProps { items: TabItem[]; value?: string | number; onChange?: (id: string | number) => void; position?: 'bottom'; minimizeOnScroll?: string; search?: boolean; onSearch?: () => void; accessory?: React.ReactNode; label?: string; lens?: boolean; className?: string }
export declare function TabBar(props: TabBarProps): React.ReactElement;

/** Glass buttons at the edges; the inline title and scroll edge appear once the large title scrolls away. */
export interface NavBarProps { title: React.ReactNode; leading?: React.ReactNode; trailing?: React.ReactNode; scroller?: string; inlineTitle?: boolean; className?: string }
export declare function NavBar(props: NavBarProps): React.ReactElement;
export declare function LargeTitle(props: { children?: React.ReactNode; as?: React.ElementType }): React.ReactElement;
export interface ScrollEdgeProps { edge?: 'top' | 'bottom'; hard?: boolean; scroller?: string; sticky?: boolean }
export declare function ScrollEdge(props: ScrollEdgeProps): React.ReactElement;

export interface SidebarProps { label: string; collapsed?: boolean; float?: boolean; header?: React.ReactNode; lens?: LensStrength; className?: string; children?: React.ReactNode }
export declare function Sidebar(props: SidebarProps): React.ReactElement;
export declare function SidebarHeading(props: { children?: React.ReactNode }): React.ReactElement;
export interface SidebarItemProps { icon?: IconName; label: string; count?: React.ReactNode; badge?: React.ReactNode; current?: boolean; href?: string; onClick?: () => void }
export declare function SidebarItem(props: SidebarItemProps): React.ReactElement;

export interface SegmentOption { value: string; label?: string; icon?: IconName; ariaLabel?: string }
/** 2 to 5 mutually exclusive options; the thumb stretches as it travels and turns to a lens when dragged. */
export interface SegmentedControlProps { options: SegmentOption[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; name?: string; label: string; size?: Size; glass?: boolean; block?: boolean; className?: string }
export declare function SegmentedControl(props: SegmentedControlProps): React.ReactElement;

export interface PageDotsProps { count: number; index?: number; onChange?: (index: number) => void; glass?: boolean | 'clear'; label?: string; className?: string }
export declare function PageDots(props: PageDotsProps): React.ReactElement;

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> { label?: React.ReactNode; tone?: 'accent'; size?: 'sm'; row?: boolean; onChange?: (checked: boolean, e: React.ChangeEvent<HTMLInputElement>) => void }
export declare function Switch(props: SwitchProps): React.ReactElement;

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'defaultValue'> { value?: number; defaultValue?: number; min?: number; max?: number; step?: number; onChange?: (value: number, e: React.ChangeEvent<HTMLInputElement>) => void; label: string; iconStart?: IconName; iconEnd?: IconName; ticks?: number; variant?: 'scrubber' }
export declare function Slider(props: SliderProps): React.ReactElement;

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> { label?: string; hint?: string; error?: string; icon?: IconName; clearable?: boolean; onClear?: () => void; multiline?: boolean; variant?: 'filled' }
export declare function TextField(props: TextFieldProps): React.ReactElement;

export interface SearchFieldProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; glass?: boolean; collapsible?: boolean; mic?: boolean; onMic?: () => void }
export declare function SearchField(props: SearchFieldProps): React.ReactElement;

export interface StepperProps { value?: number; defaultValue?: number; min?: number; max?: number; step?: number; onChange?: (value: number) => void; label: string; glass?: boolean; className?: string }
export declare function Stepper(props: StepperProps): React.ReactElement;

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> { label: React.ReactNode; description?: React.ReactNode; indeterminate?: boolean }
export declare function Checkbox(props: CheckboxProps): React.ReactElement;
export interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> { label: React.ReactNode; description?: React.ReactNode }
export declare function Radio(props: RadioProps): React.ReactElement;

export interface DialogAction { label: string; value?: string; variant?: 'filled' | 'gray' | 'plain' | 'soft'; tone?: Tone; autoFocus?: boolean }
/** A modal alert in thick glass. Controlled by `open`; onClose receives the chosen action value or 'dismiss'. */
export interface DialogProps { open: boolean; onClose?: (value: string) => void; title: React.ReactNode; message?: React.ReactNode; icon?: IconName; tone?: 'critical'; actions?: DialogAction[]; dismissible?: boolean; children?: React.ReactNode; className?: string }
export declare function Dialog(props: DialogProps): React.ReactElement;

export type Detent = 'small' | 'medium' | 'large';
/** Rises from the bottom edge: inset glass at medium, full-width and solid at large. */
export interface SheetProps { open: boolean; onClose?: (value: string) => void; detent?: Detent; detents?: Detent[]; onDetentChange?: (d: Detent) => void; title?: React.ReactNode; leading?: React.ReactNode; trailing?: React.ReactNode; inline?: boolean; children?: React.ReactNode; className?: string }
export declare function Sheet(props: SheetProps): React.ReactElement;

/** A live status capsule (upload, timer, call) that expands into a card in place. */
export interface ActivityCapsuleProps { icon?: IconName; tone?: Hue; title: React.ReactNode; subtitle?: React.ReactNode; trailing?: React.ReactNode; expanded?: boolean; onToggle?: (expanded: boolean) => void; children?: React.ReactNode; className?: string }
export declare function ActivityCapsule(props: ActivityCapsuleProps): React.ReactElement;

/** Content-layer surface. variant 'media' fills with art and carries a clear-glass caption. */
export interface CardProps { variant?: 'media'; media?: React.ReactNode; art?: 1 | 2 | 3 | 4 | 5 | 6; eyebrow?: React.ReactNode; title?: React.ReactNode; text?: React.ReactNode; footer?: React.ReactNode; caption?: React.ReactNode; href?: string; onClick?: () => void; tilt?: boolean; className?: string; children?: React.ReactNode }
export declare function Card(props: CardProps): React.ReactElement;

export interface ListProps { header?: React.ReactNode; footer?: React.ReactNode; label?: string; className?: string; children?: React.ReactNode }
export declare function List(props: ListProps): React.ReactElement;
export interface ListRowProps { icon?: IconName; tone?: Hue; thumb?: 1 | 2 | 3 | 4 | 5 | 6; avatar?: AvatarProps; title: React.ReactNode; subtitle?: React.ReactNode; detail?: React.ReactNode; chevron?: boolean; accessory?: React.ReactNode; href?: string; onClick?: () => void }
export declare function ListRow(props: ListRowProps): React.ReactElement;

export interface AvatarProps { initials?: string; src?: string; alt?: string; size?: 'xs' | 'sm' | 'lg' | 'xl'; tone?: Hue; status?: 'online' | 'away' | 'busy'; label?: string }
export declare function Avatar(props: AvatarProps): React.ReactElement;
export declare function AvatarStack(props: { people: AvatarProps[]; max?: number; label?: string }): React.ReactElement;

/** Counts (solid) or status (soft, with an icon and a word). Pops when its content changes. */
export interface BadgeProps { tone?: Tone; variant?: 'soft' | 'dot'; icon?: IconName; label?: string; children?: React.ReactNode }
export declare function Badge(props: BadgeProps): React.ReactElement;

/** A filter (pressed / onToggle) or a removable token (onRemove). */
export interface ChipProps { pressed?: boolean; onToggle?: (pressed: boolean) => void; onRemove?: () => void; removeLabel?: string; glass?: boolean; className?: string; children?: React.ReactNode }
export declare function Chip(props: ChipProps): React.ReactElement;

/** value 0..1; omit value for indeterminate. */
export interface ProgressProps { value?: number; label: string; size?: 'lg'; tone?: 'positive' }
export declare function Progress(props: ProgressProps): React.ReactElement;
export interface RingProps { value: number; label: string; size?: Size; tone?: 'positive'; showValue?: boolean }
export declare function Ring(props: RingProps): React.ReactElement;
export interface SpinnerProps { size?: Size; variant?: 'liquid' | 'ring'; label?: string }
export declare function Spinner(props: SpinnerProps): React.ReactElement;
export interface SkeletonProps { shape?: 'circle' | 'block' | 'title'; width?: string; height?: string }
export declare function Skeleton(props: SkeletonProps): React.ReactElement;

export interface PlayPauseProps { playing: boolean; onToggle?: (playing: boolean) => void; size?: 'sm'; labelPlay?: string; labelPause?: string }
export declare function PlayPause(props: PlayPauseProps): React.ReactElement;
/** Clear glass player controls over artwork, with a dimming scrim. Times in seconds. */
export interface MediaControlsProps { title: React.ReactNode; subtitle?: React.ReactNode; art?: 1 | 2 | 3 | 4 | 5 | 6; artwork?: React.ReactNode; playing: boolean; onToggle?: (playing: boolean) => void; position?: number; duration?: number; onSeek?: (t: number) => void; onPrevious?: () => void; onNext?: () => void; className?: string }
export declare function MediaControls(props: MediaControlsProps): React.ReactElement;

/** Glass shapes on one plane: they merge into one capsule and pinch apart again. */
/** Changing `merged` after the first render animates the merge or split (liquid neck). */
export interface GlassGroupProps { merged?: boolean; label: string; className?: string; children?: React.ReactNode }
export declare function GlassGroup(props: GlassGroupProps): React.ReactElement;
/** A draggable magnifying lens (keyboard: arrow keys). */
export declare function Loupe(props: { size?: number; x?: number; y?: number; label?: string }): React.ReactElement;
/** Alias of Loupe: the draggable lens shown on the Lens card. */
export declare const Lens: typeof Loupe;
/** A tinted drop that buds up to three actions. */
export declare function Droplets(props: { icon?: IconName; label?: string; actions: Array<{ icon: IconName; label: string; onSelect?: () => void }> }): React.ReactElement;
/** Scroll-driven entrance; effect 'scale' | 'blur' | 'glass' or true for rise. */
export declare function Reveal(props: { as?: React.ElementType; effect?: true | 'scale' | 'blur' | 'glass'; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>): React.ReactElement;
/** Dimming layer under clear glass on media. */
export declare function Scrim(props: { edge?: 'top' | 'both' | 'full' }): React.ReactElement;

declare global {
  interface Window {
    Refract: RefractAPI & {
      Glass: typeof Glass; Scene: typeof Scene; Icon: typeof Icon; Button: typeof Button; Toolbar: typeof Toolbar; ToolbarGroup: typeof ToolbarGroup;
      Menu: typeof Menu; MenuItem: typeof MenuItem; MenuSeparator: typeof MenuSeparator; MenuLabel: typeof MenuLabel; MenuRow: typeof MenuRow; MenuTile: typeof MenuTile;
      Popover: typeof Popover; TabBar: typeof TabBar; NavBar: typeof NavBar; LargeTitle: typeof LargeTitle; ScrollEdge: typeof ScrollEdge;
      Sidebar: typeof Sidebar; SidebarHeading: typeof SidebarHeading; SidebarItem: typeof SidebarItem; SegmentedControl: typeof SegmentedControl;
      PageDots: typeof PageDots; Switch: typeof Switch; Slider: typeof Slider; TextField: typeof TextField; SearchField: typeof SearchField;
      Stepper: typeof Stepper; Checkbox: typeof Checkbox; Radio: typeof Radio; Dialog: typeof Dialog; Sheet: typeof Sheet;
      ActivityCapsule: typeof ActivityCapsule; Card: typeof Card; List: typeof List; ListRow: typeof ListRow; Avatar: typeof Avatar;
      AvatarStack: typeof AvatarStack; Badge: typeof Badge; Chip: typeof Chip; Progress: typeof Progress; Ring: typeof Ring; Spinner: typeof Spinner;
      Skeleton: typeof Skeleton; PlayPause: typeof PlayPause; MediaControls: typeof MediaControls; GlassGroup: typeof GlassGroup; Loupe: typeof Loupe;
      Lens: typeof Loupe; Droplets: typeof Droplets; Reveal: typeof Reveal; Scrim: typeof Scrim;
    };
  }
}
